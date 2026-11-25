"""Pickup-slot logic: creation, status, smart suggestions."""
import math
from datetime import date, datetime, timedelta

from .config import settings


def fmt12(hhmm: str) -> str:
    h, m = map(int, hhmm.split(":"))
    suffix = "AM" if h < 12 else "PM"
    return f"{(h % 12) or 12}:{m:02d} {suffix}"


def slot_label(start: str, end: str) -> str:
    s, e = fmt12(start), fmt12(end)
    return f"{s[:-3]}–{e}" if s[-2:] == e[-2:] else f"{s}–{e}"


def ensure_slots(conn, day: str) -> None:
    times = []
    t = settings.slot_start_hour * 60
    while t < settings.slot_end_hour * 60:
        times.append((f"{t // 60:02d}:{t % 60:02d}", f"{(t + 15) // 60:02d}:{(t + 15) % 60:02d}"))
        t += 15
    have = conn.execute("SELECT COUNT(*) FROM pickup_slots WHERE slot_date=?", (day,)).fetchone()[0]
    if have >= len(times):
        return
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.executemany(
            "INSERT OR IGNORE INTO pickup_slots (slot_date,start_time,end_time,capacity,booked_count,status) "
            "VALUES (?,?,?,?,0,'open')", [(day, s, e, settings.slot_capacity) for s, e in times])
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


def historical_load(conn) -> dict:
    """Relative historical busyness (0..1) of every 15-min slot, from the imported dataset."""
    rows = conn.execute("SELECT time_slot_15min s, COUNT(DISTINCT order_id) n FROM historical_sales GROUP BY s").fetchall()
    if not rows:
        return {}
    mx = max(r["n"] for r in rows)
    return {r["s"]: round(r["n"] / mx, 3) for r in rows}


def slot_status(booked: int, capacity: int) -> str:
    if booked >= capacity:
        return "Full"
    if booked >= math.ceil(capacity * settings.filling_fast_ratio):
        return "Filling Fast"
    return "Available"


def is_past(slot_date: str, end_time: str, now: datetime | None = None) -> bool:
    now = now or datetime.now()
    if slot_date < now.strftime("%Y-%m-%d"):
        return True
    return slot_date == now.strftime("%Y-%m-%d") and end_time <= now.strftime("%H:%M")


def view(row, hist: dict) -> dict:
    booked, cap = row["booked_count"], row["capacity"]
    past = is_past(row["slot_date"], row["end_time"])
    closed_by_time = settings.enforce_past_slots and past
    status = "Closed" if closed_by_time else slot_status(booked, cap)
    return {
        "id": row["id"], "date": row["slot_date"],
        "start_time": row["start_time"], "end_time": row["end_time"],
        "label": slot_label(row["start_time"], row["end_time"]),
        "capacity": cap, "booked_count": booked, "remaining": max(cap - booked, 0),
        "occupancy_pct": round(100 * booked / cap),
        "status": status, "bookable": status in ("Available", "Filling Fast"),
        "historical_load": hist.get(row["start_time"], 0.0),
        "is_past": past, "recommended": False, "recommendation_reason": None,
    }


def list_slots(conn, day: str) -> list[dict]:
    ensure_slots(conn, day)
    hist = historical_load(conn)
    rows = conn.execute("SELECT * FROM pickup_slots WHERE slot_date=? ORDER BY start_time", (day,)).fetchall()
    slots = [view(r, hist) for r in rows]
    mark_recommended(slots)
    return slots


def mark_recommended(slots: list[dict], top: int = 3) -> None:
    """Smart pickup suggestion: blend of live occupancy (65%) and historical busyness (35%)."""
    cands = [s for s in slots if s["bookable"] and not (settings.enforce_past_slots and s["is_past"])]
    for s in cands:
        s["crowd_score"] = round(0.65 * s["booked_count"] / s["capacity"] + 0.35 * s["historical_load"], 3)
    for s in sorted(cands, key=lambda x: (x["crowd_score"], x["start_time"]))[:top]:
        s["recommended"] = True
        hist = "usually a quiet period" if s["historical_load"] < 0.5 else (
            "a moderately busy period historically" if s["historical_load"] < 0.8 else "historically busy, but still has room")
        s["recommendation_reason"] = f"{s['remaining']} of {s['capacity']} spots free and {hist}."


def suggest_alternatives(slots: list[dict], full_slot_id: int, limit: int = 3) -> dict:
    """Next available slot after the full one (falls back to earlier slots), plus quieter options."""
    idx = next((i for i, s in enumerate(slots) if s["id"] == full_slot_id), -1)
    later = [s for s in slots[idx + 1:] if s["bookable"]]
    earlier = [s for s in slots[:max(idx, 0)] if s["bookable"]]
    nxt = later[0] if later else (earlier[-1] if earlier else None)
    quiet = sorted([s for s in slots if s["bookable"] and s["id"] != full_slot_id],
                   key=lambda s: s.get("crowd_score", 1))[:limit]
    return {"next_available": nxt, "alternatives": (later[:limit] or earlier[-limit:]), "quietest": quiet}
