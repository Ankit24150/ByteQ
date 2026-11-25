"""Orders, kitchen view and admin helpers."""
from datetime import date, datetime

from fastapi import APIRouter, Depends, Query

from . import slots as S
from .db import get_db
from .errors import api_error
from .schemas import STATUSES, OrderIn, StatusIn

router = APIRouter(prefix="/api", tags=["orders"])
ACTIVE = ("Pending", "Accepted", "Preparing")
TERMINAL = ("Completed", "Cancelled")


def _new_order_id(conn) -> str:
    row = conn.execute(
        "SELECT order_id FROM orders WHERE order_id LIKE 'TK-%' ORDER BY id DESC LIMIT 1"
    ).fetchone()
    if row:
        try:
            last_num = int(row["order_id"].split("-", 1)[1])
        except (IndexError, ValueError):
            last_num = 0
        next_num = last_num + 1
    else:
        next_num = 1
    return f"TK-{next_num:02d}"


def _urgency(row) -> str:
    if row["status"] in ("Ready for Pickup", *TERMINAL):
        return "none"
    now = datetime.now()
    if row["slot_date"] != now.strftime("%Y-%m-%d"):
        return "normal"
    t = now.strftime("%H:%M")
    if t >= row["end_time"]:
        return "overdue"
    mins = (int(row["start_time"][:2]) * 60 + int(row["start_time"][3:])) - (now.hour * 60 + now.minute)
    return "urgent" if mins <= 15 else "normal"


def _detail(conn, order_id: str) -> dict | None:
    o = conn.execute(
        "SELECT o.*, s.slot_date, s.start_time, s.end_time, s.capacity, s.booked_count "
        "FROM orders o JOIN pickup_slots s ON s.id=o.pickup_slot WHERE o.order_id=?", (order_id,)).fetchone()
    return _hydrate(conn, o) if o else None


def _hydrate(conn, o) -> dict:
    items = conn.execute(
        "SELECT oi.menu_item_id, m.name, m.image, oi.quantity, oi.unit_price "
        "FROM order_items oi JOIN menu_items m ON m.id=oi.menu_item_id WHERE oi.order_id=? ORDER BY oi.id",
        (o["order_id"],)).fetchall()
    label = S.slot_label(o["start_time"], o["end_time"])
    ahead = 0
    if o["status"] in ACTIVE:
        ahead = conn.execute(
            "SELECT COUNT(*) FROM orders o2 JOIN pickup_slots s2 ON s2.id=o2.pickup_slot "
            "WHERE o2.status IN ('Pending','Accepted','Preparing') AND s2.slot_date=? AND "
            "(s2.start_time < ? OR (s2.start_time = ? AND o2.id < ?))",
            (o["slot_date"], o["start_time"], o["start_time"], o["id"])).fetchone()[0]
    total_qty = sum(i["quantity"] for i in items)
    prep_minutes = 3 + total_qty * 2  # base 3 min + 2 min per item
    return {
        "order_id": o["order_id"], "customer_name": o["customer_name"], "status": o["status"],
        "order_date": o["order_date"], "order_time": o["order_time"],
        "payment_method": o["payment_method"], "total_amount": o["total_amount"],
        "pickup_slot": {"id": o["pickup_slot"], "date": o["slot_date"], "start_time": o["start_time"],
                        "end_time": o["end_time"], "label": label},
        "estimated_pickup_time": f"{S.fmt12(o['start_time'])} – {S.fmt12(o['end_time'])}",
        "estimated_prep_minutes": prep_minutes,
        "remaining_capacity": max(o["capacity"] - o["booked_count"], 0),
        "orders_ahead": ahead, "urgency": _urgency(o), "updated_at": o["updated_at"],
        "total_quantity": total_qty,
        "items": [{"menu_item_id": i["menu_item_id"], "name": i["name"], "image": i["image"],
                   "quantity": i["quantity"], "unit_price": i["unit_price"],
                   "line_total": i["quantity"] * i["unit_price"]} for i in items],
    }


@router.post("/orders", status_code=201)
def create_order(body: OrderIn, conn=Depends(get_db)):
    # merge duplicate lines of the same item
    merged: dict[int, int] = {}
    for it in body.items:
        merged[it.menu_item_id] = merged.get(it.menu_item_id, 0) + it.quantity
    if any(q > 10 for q in merged.values()):
        raise api_error(422, "QUANTITY_TOO_HIGH", "Maximum 10 of any single item per order.")
    total_items = sum(merged.values())
    if total_items > 4:
        raise api_error(422, "ORDER_LIMIT_EXCEEDED",
                        f"You can order at most 4 items per order. You have {total_items} items. Please reduce your cart.")

    conn.execute("BEGIN IMMEDIATE")  # write lock: slot check + reservation is atomic
    try:
        slot = conn.execute("SELECT * FROM pickup_slots WHERE id=?", (body.slot_id,)).fetchone()
        if not slot:
            raise api_error(404, "SLOT_NOT_FOUND", f"Pickup slot {body.slot_id} does not exist.")

        ids = list(merged)
        rows = conn.execute(f"SELECT * FROM menu_items WHERE id IN ({','.join('?' * len(ids))})", ids).fetchall()
        found = {r["id"]: r for r in rows}
        missing = [i for i in ids if i not in found]
        if missing:
            raise api_error(404, "ITEM_NOT_FOUND", f"Menu item(s) {missing} do not exist.", item_ids=missing)
        unavailable = [found[i]["name"] for i in ids if not found[i]["availability"]]
        if unavailable:
            raise api_error(409, "ITEM_UNAVAILABLE",
                            f"Sorry, currently unavailable: {', '.join(unavailable)}. Please remove it from your cart.",
                            items=unavailable)

        # Check how many items this customer already ordered in this slot
        existing = conn.execute(
            "SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi "
            "JOIN orders o ON o.order_id = oi.order_id "
            "WHERE o.customer_name = ? AND o.pickup_slot = ? AND o.status <> 'Cancelled'",
            (body.customer_name, body.slot_id)).fetchone()[0]
        new_total = existing + total_items
        remaining_allowed = max(4 - existing, 0)
        if new_total > 4:
            raise api_error(422, "ORDER_LIMIT_EXCEEDED",
                            f"You already have {existing} item(s) in this slot. You can add at most {remaining_allowed} more (limit is 4 per person per slot).")

        if slot["slot_date"] < date.today().isoformat() or (
                settings_enforce() and S.is_past(slot["slot_date"], slot["end_time"])):
            raise api_error(409, "SLOT_CLOSED", "That pickup slot has already passed. Please choose another.")

        # Atomic reservation: only succeeds while booked_count < capacity.
        cur = conn.execute(
            "UPDATE pickup_slots SET booked_count=booked_count+1, "
            "status=CASE WHEN booked_count+1>=capacity THEN 'full' ELSE 'open' END "
            "WHERE id=? AND booked_count<capacity", (body.slot_id,))
        if cur.rowcount == 0:
            conn.execute("ROLLBACK")
            all_slots = S.list_slots(conn, slot["slot_date"])
            sug = S.suggest_alternatives(all_slots, body.slot_id)
            label = S.slot_label(slot["start_time"], slot["end_time"])
            nxt = sug["next_available"]
            msg = (f"The {label} slot is full ({slot['capacity']}/{slot['capacity']} orders). "
                   + (f"Next available pickup slot: {nxt['label']} ({nxt['remaining']} spots left)."
                      if nxt else "No other slots are available today."))
            raise api_error(409, "SLOT_FULL", msg, slot_id=body.slot_id, slot_label=label,
                            suggested_slot=nxt, alternatives=sug["alternatives"])

        now = datetime.now()
        total = sum(found[i]["price"] * q for i, q in merged.items())
        oid = _new_order_id(conn)
        conn.execute(
            "INSERT INTO orders (order_id,order_date,order_time,pickup_slot,customer_name,payment_method,"
            "total_amount,status,updated_at) VALUES (?,?,?,?,?,?,?,'Pending',?)",
            (oid, now.strftime("%Y-%m-%d"), now.strftime("%H:%M:%S"), body.slot_id,
             body.customer_name, body.payment_method, total, now.isoformat(timespec="seconds")))
        conn.executemany(
            "INSERT INTO order_items (order_id,menu_item_id,quantity,unit_price) VALUES (?,?,?,?)",
            [(oid, i, q, found[i]["price"]) for i, q in merged.items()])
        conn.execute("COMMIT")
    except Exception:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    return _detail(conn, oid)


def settings_enforce() -> bool:
    from .config import settings
    return settings.enforce_past_slots


def _list(conn, where="", args=()):
    rows = conn.execute(
        "SELECT o.*, s.slot_date, s.start_time, s.end_time, s.capacity, s.booked_count "
        "FROM orders o JOIN pickup_slots s ON s.id=o.pickup_slot " + where +
        " ORDER BY s.slot_date, s.start_time, o.id", args).fetchall()
    return [_hydrate(conn, r) for r in rows]


@router.get("/orders")
def list_orders(status: str | None = None, date_: str | None = Query(None, alias="date"),
                active_only: bool = False, slot_id: int | None = None, conn=Depends(get_db)):
    """Orders for the kitchen dashboard, sorted by pickup time. Default: today's orders."""
    if status and status not in STATUSES:
        raise api_error(422, "BAD_STATUS", f"status must be one of {STATUSES}")
    conds, args = ["s.slot_date=?"], [date_ or date.today().isoformat()]
    if status:
        conds.append("o.status=?"); args.append(status)
    if active_only:
        conds.append("o.status IN ('Pending','Accepted','Preparing','Ready for Pickup')")
    if slot_id:
        conds.append("o.pickup_slot=?"); args.append(slot_id)
    return _list(conn, "WHERE " + " AND ".join(conds), args)


@router.get("/orders/{order_id}")
def get_order(order_id: str, conn=Depends(get_db)):
    d = _detail(conn, order_id.strip().upper())
    if not d:
        raise api_error(404, "ORDER_NOT_FOUND", f"No order found with ID {order_id}.")
    return d


@router.patch("/orders/{order_id}/status")
def update_status(order_id: str, body: StatusIn, conn=Depends(get_db)):
    order_id = order_id.strip().upper()
    conn.execute("BEGIN IMMEDIATE")
    try:
        o = conn.execute("SELECT * FROM orders WHERE order_id=?", (order_id,)).fetchone()
        if not o:
            raise api_error(404, "ORDER_NOT_FOUND", f"No order found with ID {order_id}.")
        cur, new = o["status"], body.status
        if cur in TERMINAL:
            raise api_error(409, "ORDER_FINALISED", f"Order is already {cur} and cannot be changed.")
        if new == cur:
            raise api_error(409, "NO_CHANGE", f"Order is already {cur}.")
        if new != "Cancelled" and STATUSES.index(new) < STATUSES.index(cur):
            raise api_error(409, "INVALID_TRANSITION", f"Cannot move an order back from {cur} to {new}.")
        if new in ("Cancelled", "Completed"):  # release the reserved slot capacity
            conn.execute(
                "UPDATE pickup_slots SET booked_count=MAX(booked_count-1,0), status='open' WHERE id=?",
                (o["pickup_slot"],))
        conn.execute("UPDATE orders SET status=?, updated_at=? WHERE order_id=?",
                     (new, datetime.now().isoformat(timespec="seconds"), order_id))
        conn.execute("COMMIT")
    except Exception:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    return _detail(conn, order_id)


@router.get("/kitchen/prep-summary", tags=["kitchen"])
def prep_summary(conn=Depends(get_db)):
    """Total quantity of each item still to be prepared (today, Pending/Accepted/Preparing) + cooking queue."""
    orders = _list(conn, "WHERE s.slot_date=? AND o.status IN ('Pending','Accepted','Preparing')",
                   (date.today().isoformat(),))
    totals: dict[str, dict] = {}
    for o in orders:
        for it in o["items"]:
            t = totals.setdefault(it["name"], {"name": it["name"], "image": it["image"], "quantity": 0,
                                               "orders": 0, "next_pickup": o["pickup_slot"]["label"]})
            t["quantity"] += it["quantity"]
            t["orders"] += 1
    counts = {s: 0 for s in STATUSES}
    for r in conn.execute("SELECT o.status status, COUNT(*) n FROM orders o JOIN pickup_slots s ON s.id=o.pickup_slot "
                          "WHERE s.slot_date=? GROUP BY o.status", (date.today().isoformat(),)):
        counts[r["status"]] = r["n"]
    return {"items": sorted(totals.values(), key=lambda t: -t["quantity"]),
            "cooking_queue": [o for o in orders if o["status"] in ("Accepted", "Preparing")],
            "status_counts": counts}


@router.post("/admin/reset-live", tags=["admin"])
def reset_live_orders(conn=Depends(get_db)):
    """Demo helper: wipes LIVE orders and slot bookings. Historical dataset is never touched."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute("DELETE FROM order_items")
        conn.execute("DELETE FROM orders")
        conn.execute("UPDATE pickup_slots SET booked_count=0, status='open'")
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    return {"ok": True, "message": "Live orders cleared. Historical dataset untouched."}


@router.post("/orders/batch-status", tags=["orders"])
def batch_order_status(body: dict, conn=Depends(get_db)):
    """Look up multiple order IDs at once. Body: {"order_ids": ["TK-01","TK-02",...]}."""
    ids = body.get("order_ids", [])
    if not ids or not isinstance(ids, list):
        return []
    ids = [str(i).strip().upper() for i in ids[:30]]  # cap at 30
    result = []
    for oid in ids:
        row = conn.execute(
            "SELECT o.order_id, o.customer_name, o.status, o.total_amount, o.order_date, o.order_time "
            "FROM orders o WHERE o.order_id=?", (oid,)).fetchone()
        if row:
            total_qty = conn.execute(
                "SELECT COALESCE(SUM(quantity),0) FROM order_items WHERE order_id=?", (oid,)).fetchone()[0]
            prep_minutes = 3 + total_qty * 2
            result.append({"order_id": row["order_id"], "customer_name": row["customer_name"],
                           "status": row["status"], "total_amount": row["total_amount"],
                           "order_date": row["order_date"], "order_time": row["order_time"],
                           "total_quantity": total_qty, "estimated_prep_minutes": prep_minutes})
        else:
            result.append({"order_id": oid, "status": "Not Found"})
    return result
