"""Menu, slots, combos."""
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Query

from . import slots as S
from .db import get_db
from .errors import api_error
from .schemas import MenuPatch, SlotPatch

router = APIRouter(prefix="/api", tags=["menu & slots"])


def menu_row(r) -> dict:
    return {"id": r["id"], "name": r["name"], "category": r["category"], "price": r["price"],
            "image": r["image"], "available": bool(r["availability"])}


@router.get("/menu")
def get_menu(category: str | None = None, q: str | None = None,
             available_only: bool = False, conn=Depends(get_db)):
    sql, args = "SELECT * FROM menu_items WHERE 1=1", []
    if category:
        sql += " AND category=?"; args.append(category)
    if q:
        sql += " AND name LIKE ?"; args.append(f"%{q}%")
    if available_only:
        sql += " AND availability=1"
    rows = conn.execute(sql + " ORDER BY id", args).fetchall()
    return [menu_row(r) for r in rows]


@router.patch("/menu/{item_id}")
def patch_menu(item_id: int, body: MenuPatch, conn=Depends(get_db)):
    row = conn.execute("SELECT * FROM menu_items WHERE id=?", (item_id,)).fetchone()
    if not row:
        raise api_error(404, "ITEM_NOT_FOUND", f"Menu item {item_id} does not exist.")
    avail = row["availability"] if body.availability is None else int(body.availability)
    price = row["price"] if body.price is None else body.price
    conn.execute("UPDATE menu_items SET availability=?, price=? WHERE id=?", (avail, price, item_id))
    return menu_row(conn.execute("SELECT * FROM menu_items WHERE id=?", (item_id,)).fetchone())


def _day(d: str | None) -> str:
    today = date.today()
    if not d:
        return today.isoformat()
    try:
        parsed = date.fromisoformat(d)
    except ValueError:
        raise api_error(422, "BAD_DATE", "date must be YYYY-MM-DD.")
    if parsed < today or parsed > today + timedelta(days=7):
        raise api_error(422, "BAD_DATE", "Slots can only be viewed for today up to 7 days ahead.")
    return parsed.isoformat()


@router.get("/slots")
def get_slots(date: str | None = Query(None, description="YYYY-MM-DD (default today)"), conn=Depends(get_db)):
    day = _day(date)
    slots = S.list_slots(conn, day)
    return {"date": day, "slots": slots,
            "best_slot": next((s for s in sorted([x for x in slots if x["recommended"]],
                                                 key=lambda x: x["crowd_score"])), None)}


@router.patch("/slots/{slot_id}")
def patch_slot(slot_id: int, body: SlotPatch, conn=Depends(get_db)):
    """Admin: change a slot's capacity (cannot go below what is already booked)."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        row = conn.execute("SELECT * FROM pickup_slots WHERE id=?", (slot_id,)).fetchone()
        if not row:
            conn.execute("ROLLBACK")
            raise api_error(404, "SLOT_NOT_FOUND", f"Slot {slot_id} does not exist.")
        if body.capacity < row["booked_count"]:
            conn.execute("ROLLBACK")
            raise api_error(409, "CAPACITY_TOO_LOW",
                            f"{row['booked_count']} orders are already booked; capacity cannot be lower.")
        conn.execute("UPDATE pickup_slots SET capacity=?, status=CASE WHEN booked_count>=? THEN 'full' ELSE 'open' END WHERE id=?",
                     (body.capacity, body.capacity, slot_id))
        conn.execute("COMMIT")
    except Exception:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    hist = S.historical_load(conn)
    return S.view(conn.execute("SELECT * FROM pickup_slots WHERE id=?", (slot_id,)).fetchone(), hist)


@router.get("/combos")
def combo_of_the_day(weekday: str | None = None, conn=Depends(get_db)):
    """Combos built from the most-sold items on this weekday in the historical dataset.
    Combo price = sum of current menu prices (no hidden discount)."""
    wd = weekday or datetime.now().strftime("%A")
    sold = conn.execute(
        "SELECT item, SUM(quantity) q FROM historical_sales WHERE weekday=? GROUP BY item ORDER BY q DESC", (wd,)).fetchall()
    if not sold:
        sold = conn.execute("SELECT item, SUM(quantity) q FROM historical_sales GROUP BY item ORDER BY q DESC").fetchall()
    menu = {r["name"]: r for r in conn.execute("SELECT * FROM menu_items").fetchall()}
    ranked = [(menu[r["item"]], r["q"]) for r in sold if r["item"] in menu and menu[r["item"]]["availability"]]

    def pick(cats, exclude=(), nth=0):
        c = [m for m, _ in ranked if m["category"] in cats and m["name"] not in exclude]
        return c[nth] if len(c) > nth else None

    plans = [
        (f"{wd} Power Lunch", [pick(("Meals",)), pick(("Beverages",))],
         "Top-selling meal on {wd}s paired with the most popular drink."),
        ("Fast Bite Combo", [pick(("Fast Food",)), pick(("Snacks",)), pick(("Beverages",), nth=1)],
         "Most popular fast food + snack + a second-favourite drink."),
        ("Quick & Cheap Combo", [pick(("Snacks",)), pick(("Beverages",), nth=2) or pick(("Beverages",))],
         "Budget pick: best-selling snack with a light drink."),
    ]
    out = []
    for name, items, why in plans:
        items = [i for i in items if i]
        if len(items) < 2 or len({i["id"] for i in items}) != len(items):
            continue
        out.append({"name": name, "weekday": wd, "reason": why.format(wd=wd),
                    "items": [menu_row(i) | {"quantity": 1} for i in items],
                    "total_price": sum(i["price"] for i in items)})
    return {"weekday": wd, "based_on": "historical dataset", "combos": out}
