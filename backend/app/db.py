"""SQLite connection handling and schema."""
import sqlite3
from .config import settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS menu_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL UNIQUE,
    category     TEXT NOT NULL CHECK (category IN ('Snacks','Meals','Beverages','Fast Food')),
    price        INTEGER NOT NULL CHECK (price > 0),
    image        TEXT,
    availability INTEGER NOT NULL DEFAULT 1 CHECK (availability IN (0,1))
);

CREATE TABLE IF NOT EXISTS pickup_slots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_date    TEXT NOT NULL,
    start_time   TEXT NOT NULL,
    end_time     TEXT NOT NULL,
    capacity     INTEGER NOT NULL CHECK (capacity > 0),
    booked_count INTEGER NOT NULL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','full')),
    UNIQUE (slot_date, start_time),
    CHECK (booked_count >= 0 AND booked_count <= capacity)
);

CREATE TABLE IF NOT EXISTS orders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id       TEXT NOT NULL UNIQUE,
    order_date     TEXT NOT NULL,
    order_time     TEXT NOT NULL,
    pickup_slot    INTEGER NOT NULL REFERENCES pickup_slots(id),
    customer_name  TEXT NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'cash_on_pickup',
    total_amount   INTEGER NOT NULL CHECK (total_amount >= 0),
    status         TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN
                   ('Pending','Accepted','Preparing','Ready for Pickup','Completed','Cancelled')),
    updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_slot ON orders(pickup_slot);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS order_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id     TEXT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
    quantity     INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
    unit_price   INTEGER NOT NULL CHECK (unit_price > 0)
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- Verbatim copy of the user's dataset (Orders sheet). Never modified by the app.
CREATE TABLE IF NOT EXISTS historical_sales (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id         TEXT NOT NULL,
    order_date       TEXT NOT NULL,
    weekday          TEXT NOT NULL,
    order_time       TEXT NOT NULL,
    time_slot_15min  TEXT NOT NULL,
    item             TEXT NOT NULL,
    quantity         INTEGER NOT NULL,
    unit_price_inr   INTEGER NOT NULL,
    total_price_inr  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hist_date ON historical_sales(order_date);
CREATE INDEX IF NOT EXISTS idx_hist_item ON historical_sales(item);
"""


def connect() -> sqlite3.Connection:
    # isolation_level=None -> autocommit; transactions are explicit (BEGIN IMMEDIATE)
    conn = sqlite3.connect(settings.db_path, timeout=30, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


def init_db() -> None:
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = connect()
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA)
    finally:
        conn.close()


def get_db():
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()
