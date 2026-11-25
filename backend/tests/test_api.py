"""End-to-end tests against a REAL running server (separate process, temp SQLite DB).
Run:  cd backend && pytest -v
"""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def base():
    port, tmp = _free_port(), tempfile.mkdtemp()
    env = {**os.environ, "CANTEEN_DB": f"{tmp}/test.db", "SLOT_CAPACITY": "10", "ENFORCE_PAST_SLOTS": "false"}
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(port)],
                            cwd=BACKEND, env=env, stdout=subprocess.DEVNULL, stderr=open(os.environ.get("TEST_SERVER_LOG", os.devnull), "w"))
    url = f"http://127.0.0.1:{port}"
    for _ in range(60):
        try:
            urllib.request.urlopen(url + "/api/health", timeout=1)
            break
        except Exception:
            time.sleep(0.5)
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield url
    proc.terminate()


def call(base, method, path, body=None):
    req = urllib.request.Request(base + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


@pytest.fixture(autouse=True)
def clean(base):
    call(base, "POST", "/api/admin/reset-live")
    for m in call(base, "GET", "/api/menu")[1]:   # make sure everything is available
        call(base, "PATCH", f"/api/menu/{m['id']}", {"availability": True})
    call(base, "GET", "/api/slots")  # ensure slots exist
    sid = slot_by_start(base, "11:00")["id"]
    call(base, "PATCH", f"/api/slots/{sid}", {"capacity": 10})
    yield


def slot_by_start(base, start):
    return next(s for s in call(base, "GET", "/api/slots")[1]["slots"] if s["start_time"] == start)


def order(base, slot_id, name="Test Student", items=None):
    return call(base, "POST", "/api/orders", {"customer_name": name, "slot_id": slot_id,
                                              "items": items or [{"menu_item_id": 1, "quantity": 2}]})


# 1 + 3: successful order, receives a pickup slot
def test_place_order_success(base):
    slot = slot_by_start(base, "13:00")
    code, o = order(base, slot["id"], items=[{"menu_item_id": 1, "quantity": 2}, {"menu_item_id": 12, "quantity": 1}])
    assert code == 201
    assert o["order_id"].startswith("CNT-") and o["status"] == "Pending"
    assert o["total_amount"] == 2 * 15 + 12
    assert o["pickup_slot"]["label"] == "1:00–1:15 PM" and o["estimated_pickup_time"] == "1:00 PM – 1:15 PM"
    assert o["remaining_capacity"] == 9
    assert call(base, "GET", f"/api/orders/{o['order_id']}")[1]["order_id"] == o["order_id"]


# 2 + 9: order appears in kitchen; kitchen updates status
def test_kitchen_flow_and_status_updates(base):
    slot = slot_by_start(base, "12:00")
    _, o = order(base, slot["id"])
    kitchen = call(base, "GET", "/api/orders")[1]
    assert any(k["order_id"] == o["order_id"] for k in kitchen)
    prep = call(base, "GET", "/api/kitchen/prep-summary")[1]
    assert next(i for i in prep["items"] if i["name"] == "Samosa")["quantity"] == 2
    for st in ["Accepted", "Preparing", "Ready for Pickup", "Completed"]:
        code, upd = call(base, "PATCH", f"/api/orders/{o['order_id']}/status", {"status": st})
        assert code == 200 and upd["status"] == st
    code, err = call(base, "PATCH", f"/api/orders/{o['order_id']}/status", {"status": "Preparing"})
    assert code == 409 and "message" in err["detail"]
    assert call(base, "PATCH", f"/api/orders/{o['order_id']}/status", {"status": "Bogus"})[0] == 422


# 4: multiple students, unique IDs
def test_multiple_students_unique_ids(base):
    slot = slot_by_start(base, "12:15")
    ids = {order(base, slot["id"], name=f"Student {i}")[1]["order_id"] for i in range(5)}
    assert len(ids) == 5
    assert slot_by_start(base, "12:15")["booked_count"] == 5


# 5, 6, 7: THE judges' demo - fill 1:00-1:15 PM, reject next, suggest alternative
def test_full_slot_rejects_and_suggests_next(base):
    slot = slot_by_start(base, "13:00")
    for i in range(10):
        code, o = order(base, slot["id"], name=f"Judge {i}")
        assert code == 201, o
    s = slot_by_start(base, "13:00")
    assert s["remaining"] == 0 and s["status"] == "Full" and not s["bookable"]  # auto-closed
    code, err = order(base, slot["id"], name="Eleventh")
    assert code == 409
    d = err["detail"]
    assert d["code"] == "SLOT_FULL" and "full" in d["message"].lower()
    assert d["suggested_slot"]["start_time"] == "13:15" and d["suggested_slot"]["remaining"] == 10
    assert slot_by_start(base, "13:00")["booked_count"] == 10  # unchanged by the rejected order
    # the suggested slot really accepts the order
    assert order(base, d["suggested_slot"]["id"], name="Eleventh")[0] == 201


# 8: cancelling releases capacity
def test_cancel_releases_capacity(base):
    slot = slot_by_start(base, "13:00")
    oids = [order(base, slot["id"], name=f"S{i}")[1]["order_id"] for i in range(10)]
    assert order(base, slot["id"])[0] == 409
    code, c = call(base, "PATCH", f"/api/orders/{oids[0]}/status", {"status": "Cancelled"})
    assert code == 200 and c["status"] == "Cancelled"
    s = slot_by_start(base, "13:00")
    assert s["booked_count"] == 9 and s["status"] == "Filling Fast" and s["remaining"] == 1
    assert order(base, slot["id"])[0] == 201
    # cancelling twice must not release capacity twice
    assert call(base, "PATCH", f"/api/orders/{oids[0]}/status", {"status": "Cancelled"})[0] == 409
    assert slot_by_start(base, "13:00")["booked_count"] == 10


# 10: analytics come from the imported dataset
def test_analytics_use_imported_dataset(base):
    assert call(base, "GET", "/api/analytics/summary")[1]["total_orders"] == 5078
    peak = call(base, "GET", "/api/analytics/peak-slots")[1]
    assert peak["peak"]["slot"] == "12:45" and peak["peak"]["total_orders"] == 576
    assert sum(s["total_orders"] for s in peak["slots"]) == 5078
    top = call(base, "GET", "/api/analytics/top-items")[1]
    assert top["overall"][0]["item"] == "Samosa" and len(top["overall"]) == 5
    assert all(len(v) == 5 for v in top["by_weekday"].values())
    assert top["by_weekday"]["Monday"][0] == {"item": "Samosa", "quantity_sold": 161, "order_count": 104, "revenue": 2415}
    daily = call(base, "GET", "/api/analytics/daily-sales")[1]
    assert len(daily["days"]) == 30 and daily["days"][0]["total_orders"] == 205 and daily["days"][0]["revenue"] == 12110
    assert daily["average_daily_orders"] == round(5078 / 30, 1)
    rec = call(base, "GET", "/api/analytics/recommendations?weekday=Monday")[1]
    assert rec["recommendations"][0]["recommended_quantity"] > 0 and rec["recommendations"][0]["reason"]
    # live orders do not leak into historical analytics
    order(base, slot_by_start(base, "13:00")["id"])
    assert call(base, "GET", "/api/analytics/summary")[1]["total_orders"] == 5078
    assert call(base, "GET", "/api/analytics/live")[1]["orders_today"] == 1


# 11: invalid orders / unavailable food
def test_invalid_and_unavailable(base):
    sid = slot_by_start(base, "13:00")["id"]
    assert call(base, "POST", "/api/orders", {"customer_name": "A", "slot_id": sid, "items": []})[0] == 422
    assert order(base, sid, items=[{"menu_item_id": 1, "quantity": 0}])[0] == 422
    assert order(base, sid, items=[{"menu_item_id": 1, "quantity": 11}])[0] == 422
    code, e = order(base, sid, items=[{"menu_item_id": 999, "quantity": 1}])
    assert code == 404 and e["detail"]["code"] == "ITEM_NOT_FOUND"
    assert order(base, 99999)[0] == 404
    assert order(base, sid, name=" ")[0] == 422
    call(base, "PATCH", "/api/menu/1", {"availability": False})
    code, e = order(base, sid, items=[{"menu_item_id": 1, "quantity": 1}])
    assert code == 409 and e["detail"]["code"] == "ITEM_UNAVAILABLE" and "Samosa" in e["detail"]["message"]
    assert slot_by_start(base, "13:00")["booked_count"] == 0  # failed orders reserve nothing
    assert call(base, "GET", "/api/orders/NOPE")[0] == 404


# 12: simultaneous requests can never exceed capacity
def test_concurrent_orders_never_exceed_capacity(base):
    sid = slot_by_start(base, "13:30")["id"]
    with ThreadPoolExecutor(max_workers=40) as ex:
        results = list(ex.map(lambda i: order(base, sid, name=f"Racer {i}"), range(40)))
    codes = [c for c, _ in results]
    assert codes.count(201) == 10, codes
    assert codes.count(409) == 30
    s = slot_by_start(base, "13:30")
    assert s["booked_count"] == 10 and s["status"] == "Full"
    orders = call(base, "GET", f"/api/orders?slot_id={sid}")[1]
    assert len(orders) == 10 and len({o["order_id"] for o in orders}) == 10


def test_queue_meter_statuses_and_smart_suggestion(base):
    sid = slot_by_start(base, "12:30")["id"]
    for i in range(7):
        order(base, sid, name=f"Q{i}")
    assert slot_by_start(base, "12:30")["status"] == "Filling Fast"
    slots = call(base, "GET", "/api/slots")[1]
    assert slots["best_slot"] and slots["best_slot"]["status"] != "Full"
    assert slots["best_slot"]["start_time"] != "12:30"
    combos = call(base, "GET", "/api/combos")[1]["combos"]
    menu = {m["id"]: m["price"] for m in call(base, "GET", "/api/menu")[1]}
    assert combos and all(c["total_price"] == sum(menu[i["id"]] for i in c["items"]) for c in combos)
