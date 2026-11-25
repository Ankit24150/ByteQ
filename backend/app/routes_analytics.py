"""Analytics. /api/analytics/* (except /live) is computed ONLY from the imported historical dataset."""
import math
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends

from . import slots as S
from .db import get_db
from .errors import api_error

router = APIRouter(prefix="/api/analytics", tags=["analytics"])
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
SOURCE = {"source": "historical_dataset", "description": "Imported 30-day dataset (not live orders)"}


def _days(conn):
    return [r["d"] for r in conn.execute("SELECT DISTINCT order_date d FROM historical_sales ORDER BY d")]


def _require_data(conn):
    if not conn.execute("SELECT 1 FROM historical_sales LIMIT 1").fetchone():
        raise api_error(503, "NO_HISTORICAL_DATA",
                        "Historical dataset not imported. Run: python import_dataset.py")


@router.get("/summary")
def summary(conn=Depends(get_db)):
    _require_data(conn)
    r = conn.execute("SELECT COUNT(DISTINCT order_id) orders, SUM(quantity) units, SUM(total_price_inr) revenue, "
                     "MIN(order_date) first, MAX(order_date) last, COUNT(DISTINCT order_date) days FROM historical_sales").fetchone()
    peak = conn.execute("SELECT time_slot_15min s, COUNT(DISTINCT order_id) n FROM historical_sales GROUP BY s ORDER BY n DESC LIMIT 1").fetchone()
    top = conn.execute("SELECT item, SUM(quantity) q FROM historical_sales GROUP BY item ORDER BY q DESC LIMIT 1").fetchone()
    return {**SOURCE, "total_orders": r["orders"], "total_units": r["units"], "total_revenue": r["revenue"],
            "first_date": r["first"], "last_date": r["last"], "days": r["days"],
            "avg_daily_orders": round(r["orders"] / r["days"], 1),
            "avg_daily_revenue": round(r["revenue"] / r["days"]),
            "peak_slot": peak["s"], "peak_slot_orders": peak["n"], "top_item": top["item"], "top_item_units": top["q"]}


@router.get("/peak-slots")
def peak_slots(conn=Depends(get_db)):
    _require_data(conn)
    n_days = len(_days(conn))
    rows = conn.execute("SELECT time_slot_15min slot, COUNT(DISTINCT order_id) total_orders, SUM(quantity) total_items, "
                        "SUM(total_price_inr) revenue FROM historical_sales GROUP BY slot ORDER BY slot").fetchall()
    mx = max(r["total_orders"] for r in rows)
    out = []
    for r in rows:
        h, m = map(int, r["slot"].split(":"))
        end = f"{(h * 60 + m + 15) // 60:02d}:{(h * 60 + m + 15) % 60:02d}"
        out.append({"slot": r["slot"], "label": S.slot_label(r["slot"], end), "total_orders": r["total_orders"],
                    "total_items": r["total_items"], "revenue": r["revenue"],
                    "avg_orders_per_day": round(r["total_orders"] / n_days, 1), "is_peak": r["total_orders"] == mx})
    ranked = sorted(out, key=lambda x: -x["total_orders"])
    return {**SOURCE, "days": n_days, "slots": out, "busiest": ranked[:3], "peak": ranked[0]}


@router.get("/top-items")
def top_items(conn=Depends(get_db)):
    _require_data(conn)
    overall = [dict(r) for r in conn.execute(
        "SELECT item, SUM(quantity) quantity_sold, COUNT(DISTINCT order_id) order_count, SUM(total_price_inr) revenue "
        "FROM historical_sales GROUP BY item ORDER BY quantity_sold DESC LIMIT 5")]
    by_wd = {}
    for wd in WEEKDAYS:
        by_wd[wd] = [dict(r) for r in conn.execute(
            "SELECT item, SUM(quantity) quantity_sold, COUNT(DISTINCT order_id) order_count, SUM(total_price_inr) revenue "
            "FROM historical_sales WHERE weekday=? GROUP BY item ORDER BY quantity_sold DESC, item LIMIT 5", (wd,))]
    return {**SOURCE, "overall": overall, "by_weekday": by_wd}


@router.get("/daily-sales")
def daily_sales(conn=Depends(get_db)):
    _require_data(conn)
    rows = conn.execute("SELECT order_date date, weekday, COUNT(DISTINCT order_id) total_orders, SUM(quantity) total_units, "
                        "SUM(total_price_inr) revenue FROM historical_sales GROUP BY order_date ORDER BY order_date").fetchall()
    days = [dict(r) for r in rows]
    n = len(days)
    return {**SOURCE, "days": days,
            "average_daily_orders": round(sum(d["total_orders"] for d in days) / n, 1),
            "average_daily_units": round(sum(d["total_units"] for d in days) / n, 1),
            "average_daily_revenue": round(sum(d["revenue"] for d in days) / n),
            "total_orders": sum(d["total_orders"] for d in days), "total_revenue": sum(d["revenue"] for d in days),
            "busiest_day": max(days, key=lambda d: d["total_orders"]),
            "quietest_day": min(days, key=lambda d: d["total_orders"])}


def _item_stats(conn):
    """Per item: daily unit lists per weekday (zeros included), overall avg, trend."""
    days = _days(conn)
    wd_of = {r["d"]: r["w"] for r in conn.execute("SELECT DISTINCT order_date d, weekday w FROM historical_sales")}
    n_wd = {w: sum(1 for d in days if wd_of[d] == w) for w in WEEKDAYS}
    items = conn.execute("SELECT name, category, price FROM menu_items ORDER BY id").fetchall()
    sales = {}
    for r in conn.execute("SELECT item, order_date d, SUM(quantity) q FROM historical_sales GROUP BY item, d"):
        sales.setdefault(r["item"], {})[r["d"]] = r["q"]
    recent, prior = days[-7:], days[:-7]
    stats = []
    for it in items:
        per = sales.get(it["name"], {})
        wd_sum = {w: 0 for w in WEEKDAYS}
        for d, q in per.items():
            wd_sum[wd_of[d]] += q
        wd_avg = {w: round(wd_sum[w] / n_wd[w], 1) if n_wd[w] else 0 for w in WEEKDAYS}
        total = sum(per.values())
        r_avg = sum(per.get(d, 0) for d in recent) / max(len(recent), 1)
        p_avg = sum(per.get(d, 0) for d in prior) / max(len(prior), 1)
        trend = round(100 * (r_avg - p_avg) / p_avg, 1) if p_avg else 0.0
        stats.append({"item": it["name"], "category": it["category"], "price": it["price"], "total_units": total,
                      "avg_daily_units": round(total / len(days), 1), "weekday_avg": wd_avg, "trend_pct": trend,
                      "n_weekday_samples": n_wd})
    ranked = sorted(stats, key=lambda s: -s["total_units"])
    k = max(len(ranked) // 3, 1)
    for i, s in enumerate(ranked):
        s["demand_level"] = "High" if i < k else ("Low" if i >= len(ranked) - k else "Medium")
        s["rank"] = i + 1
    return stats, n_wd


@router.get("/demand")
def demand(conn=Depends(get_db)):
    _require_data(conn)
    stats, _ = _item_stats(conn)
    wd_tot = conn.execute("SELECT weekday, COUNT(DISTINCT order_date) d, COUNT(DISTINCT order_id) o, SUM(quantity) u, SUM(total_price_inr) r "
                          "FROM historical_sales GROUP BY weekday").fetchall()
    wmap = {r["weekday"]: r for r in wd_tot}
    weekday_trend = [{"weekday": w, "avg_orders": round(wmap[w]["o"] / wmap[w]["d"], 1),
                      "avg_units": round(wmap[w]["u"] / wmap[w]["d"], 1),
                      "avg_revenue": round(wmap[w]["r"] / wmap[w]["d"])} for w in WEEKDAYS if w in wmap]
    for s in stats:
        wa = s["weekday_avg"]
        s["best_weekday"] = max(wa, key=wa.get)
        s["worst_weekday"] = min(wa, key=wa.get)
        del s["n_weekday_samples"]
    return {**SOURCE, "items": sorted(stats, key=lambda s: s["rank"]), "weekday_trend": weekday_trend,
            "high_demand": [s["item"] for s in stats if s["demand_level"] == "High"],
            "low_demand": [s["item"] for s in stats if s["demand_level"] == "Low"]}


@router.get("/recommendations")
def recommendations(weekday: str | None = None, buffer: float = 0.10, conn=Depends(get_db)):
    """Smart cook-ahead: recommended preparation quantities for the target weekday."""
    _require_data(conn)
    if weekday:
        weekday = weekday.capitalize()
        if weekday not in WEEKDAYS:
            raise api_error(422, "BAD_WEEKDAY", f"weekday must be one of {WEEKDAYS}")
        target_date = None
    else:  # lunch service is over after 15:00 -> plan for tomorrow
        now = datetime.now()
        d = now.date() + timedelta(days=1 if now.hour >= 15 else 0)
        weekday, target_date = WEEKDAYS[d.weekday()], d.isoformat()
    buffer = min(max(buffer, 0), 0.5)
    stats, n_wd = _item_stats(conn)
    # best selling 15-min slot per item on this weekday
    best_slot = {}
    for r in conn.execute("SELECT item, time_slot_15min s, SUM(quantity) q FROM historical_sales WHERE weekday=? GROUP BY item, s", (weekday,)):
        if r["item"] not in best_slot or r["q"] > best_slot[r["item"]][1]:
            best_slot[r["item"]] = (r["s"], r["q"])
    preordered = {}
    if target_date:
        for r in conn.execute("SELECT m.name n, SUM(oi.quantity) q FROM order_items oi JOIN orders o ON o.order_id=oi.order_id "
                              "JOIN pickup_slots s ON s.id=o.pickup_slot JOIN menu_items m ON m.id=oi.menu_item_id "
                              "WHERE s.slot_date=? AND o.status<>'Cancelled' GROUP BY m.name", (target_date,)):
            preordered[r["n"]] = r["q"]
    out = []
    for s in stats:
        avg = s["weekday_avg"][weekday]
        adj, note = buffer, ""
        if s["trend_pct"] >= 10 and s["demand_level"] != "Low":
            adj += 0.05; note = f" Demand is trending up ({s['trend_pct']:+.0f}% last 7 days vs earlier), so +5% extra."
        elif s["trend_pct"] <= -10:
            adj -= 0.05; note = f" Demand is trending down ({s['trend_pct']:+.0f}% last 7 days), so 5% less to avoid waste."
        if s["demand_level"] == "Low":
            adj = min(adj, 0.0)
            note += " Low-demand item: cook in small batches to avoid wastage."
        qty = max(math.ceil(avg * (1 + adj)), 0)
        slot = best_slot.get(s["item"])
        cook_by = None
        if slot:
            h, m = map(int, slot[0].split(":"))
            cb = h * 60 + m - 30
            cook_by = f"{cb // 60:02d}:{cb % 60:02d}"
        reason = (f"Sold {avg} units on an average {weekday} ({n_wd[weekday]} {weekday}s of data); "
                  f"+{round(adj * 100)}% safety buffer." if adj >= 0 else
                  f"Sold {avg} units on an average {weekday} ({n_wd[weekday]} {weekday}s of data); {round(adj * 100)}% buffer.")
        reason += note
        if slot:
            reason += f" Peaks at {S.fmt12(slot[0])}; have it ready by {S.fmt12(cook_by)}."
        out.append({"item": s["item"], "category": s["category"], "demand_level": s["demand_level"],
                    "avg_units_this_weekday": avg, "recommended_quantity": qty, "trend_pct": s["trend_pct"],
                    "peak_slot": slot[0] if slot else None, "cook_by": cook_by,
                    "live_preordered": preordered.get(s["item"], 0), "reason": reason})
    out.sort(key=lambda x: -x["recommended_quantity"])
    return {**SOURCE, "weekday": weekday, "target_date": target_date, "buffer_pct": round(buffer * 100),
            "total_recommended_units": sum(o["recommended_quantity"] for o in out), "recommendations": out}


@router.get("/live")
def live(conn=Depends(get_db)):
    """LIVE orders placed through this app (separate from the historical dataset)."""
    today = date.today().isoformat()
    r = conn.execute("SELECT COUNT(*) n, COALESCE(SUM(total_amount),0) rev FROM orders o JOIN pickup_slots s ON s.id=o.pickup_slot "
                     "WHERE s.slot_date=? AND o.status<>'Cancelled'", (today,)).fetchone()
    by_status = {row["status"]: row["n"] for row in conn.execute(
        "SELECT o.status status, COUNT(*) n FROM orders o JOIN pickup_slots s ON s.id=o.pickup_slot WHERE s.slot_date=? GROUP BY o.status", (today,))}
    top = [dict(x) for x in conn.execute(
        "SELECT m.name item, SUM(oi.quantity) quantity FROM order_items oi JOIN orders o ON o.order_id=oi.order_id "
        "JOIN pickup_slots s ON s.id=o.pickup_slot JOIN menu_items m ON m.id=oi.menu_item_id "
        "WHERE s.slot_date=? AND o.status<>'Cancelled' GROUP BY m.name ORDER BY quantity DESC LIMIT 5", (today,))]
    slots = S.list_slots(conn, today)
    return {"source": "live_orders", "description": "Orders placed in this app today (not the historical dataset)",
            "date": today, "orders_today": r["n"], "revenue_today": r["rev"], "by_status": by_status,
            "top_items": top, "slots": [{"slot": s["start_time"], "label": s["label"], "booked": s["booked_count"],
                                         "capacity": s["capacity"], "status": s["status"]} for s in slots]}


@router.get("/hot-today")
def hot_today(conn=Depends(get_db)):
    """Returns the most ordered item today (live orders), or falls back to historical data for today's weekday."""
    today = date.today().isoformat()
    weekday = datetime.now().strftime("%A")

    # Try live orders first
    live_row = conn.execute(
        "SELECT m.name, m.image, m.category, m.price, SUM(oi.quantity) qty "
        "FROM order_items oi JOIN orders o ON o.order_id = oi.order_id "
        "JOIN pickup_slots s ON s.id = o.pickup_slot "
        "JOIN menu_items m ON m.id = oi.menu_item_id "
        "WHERE s.slot_date = ? AND o.status <> 'Cancelled' "
        "GROUP BY m.name ORDER BY qty DESC LIMIT 1", (today,)).fetchone()

    if live_row and live_row["qty"] >= 1:
        return {"source": "live", "item": live_row["name"], "image": live_row["image"],
                "category": live_row["category"], "price": live_row["price"],
                "quantity": live_row["qty"], "label": f"\U0001f525 {live_row['name']} is trending today!"}

    # Fallback to historical
    hist = conn.execute(
        "SELECT item, SUM(quantity) qty FROM historical_sales "
        "WHERE weekday = ? GROUP BY item ORDER BY qty DESC LIMIT 1", (weekday,)).fetchone()

    if hist:
        menu_row = conn.execute("SELECT * FROM menu_items WHERE name = ?", (hist["item"],)).fetchone()
        if menu_row:
            return {"source": "historical", "item": hist["item"], "image": menu_row["image"],
                    "category": menu_row["category"], "price": menu_row["price"],
                    "quantity": hist["qty"], "label": f"\U0001f525 {hist['item']} is the hot pick on {weekday}s!"}

    return {"source": "none", "item": None, "label": "No trending item yet \u2014 be the first to order!"}
