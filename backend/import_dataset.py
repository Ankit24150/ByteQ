#!/usr/bin/env python3
"""Import the existing 30-day canteen dataset (CSV or Excel) into SQLite.

* The source file is only READ - it is never modified or deleted.
* Column names are mapped through COLUMN_ALIASES, so slightly different headers work.
* historical_sales receives a verbatim copy of every order row.
* menu_items is seeded from the dataset's Menu sheet (or derived from the orders).
* Idempotent: skipped if historical_sales already has rows, unless --force is given.

Usage:  python import_dataset.py [path/to/file.xlsx|csv] [--force]
"""
import argparse
import sys
from pathlib import Path

import pandas as pd

from app import catalog
from app.config import settings
from app.db import connect, init_db

COLUMN_ALIASES = {
    "order_id": ["order_id", "orderid", "order id", "id"],
    "order_date": ["order_date", "date", "orderdate"],
    "weekday": ["weekday", "day", "day_of_week"],
    "order_time": ["order_time", "time", "ordertime"],
    "time_slot_15min": ["time_slot_15min", "time_slot", "slot", "slot_15min"],
    "item": ["item", "item_name", "food", "food_item", "name"],
    "quantity": ["quantity", "qty"],
    "unit_price_inr": ["unit_price_inr", "unit_price", "price"],
    "total_price_inr": ["total_price_inr", "total_price", "total", "amount"],
}
REQUIRED = ["order_id", "order_date", "order_time", "item", "quantity", "unit_price_inr"]


def _map_columns(df: pd.DataFrame) -> pd.DataFrame:
    lowered = {str(c).strip().lower(): c for c in df.columns}
    rename = {}
    for target, aliases in COLUMN_ALIASES.items():
        for a in aliases:
            if a in lowered:
                rename[lowered[a]] = target
                break
    df = df.rename(columns=rename)
    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        raise ValueError(f"Dataset is missing required columns {missing}. Found: {list(df.columns)}")
    return df


def _read(path: Path):
    """Return (orders_df, menu_df_or_None)."""
    if path.suffix.lower() == ".csv":
        return pd.read_csv(path), None
    sheets = pd.read_excel(path, sheet_name=None)
    orders = None
    for name, df in sheets.items():
        try:
            _map_columns(df.copy())
            orders = df
            if name.lower() == "orders":
                break
        except ValueError:
            continue
    if orders is None:
        raise ValueError("No sheet with order columns found in workbook")
    menu = next((df for n, df in sheets.items() if n.lower() == "menu"), None)
    return orders, menu


def import_dataset(path: Path, force: bool = False, verbose: bool = True) -> dict:
    log = print if verbose else (lambda *a, **k: None)
    init_db()
    conn = connect()
    try:
        existing = conn.execute("SELECT COUNT(*) FROM historical_sales").fetchone()[0]
        if existing and not force:
            log(f"historical_sales already has {existing} rows - skipping (use --force to reload).")
            return {"imported": 0, "skipped": True, "existing": existing}
        if not path.exists():
            raise FileNotFoundError(f"Dataset not found: {path}")

        orders, menu = _read(path)
        log(f"Read {len(orders)} rows from {path.name}; columns: {list(orders.columns)}")
        orders = _map_columns(orders)
        orders = orders.dropna(subset=REQUIRED).copy()
        orders["order_date"] = pd.to_datetime(orders["order_date"]).dt.strftime("%Y-%m-%d")
        orders["order_time"] = orders["order_time"].astype(str).str.slice(0, 8)
        if "weekday" not in orders.columns:
            orders["weekday"] = pd.to_datetime(orders["order_date"]).dt.day_name()
        if "time_slot_15min" not in orders.columns:
            t = pd.to_datetime(orders["order_time"], format="%H:%M:%S")
            orders["time_slot_15min"] = (t.dt.hour.astype(str).str.zfill(2) + ":" +
                                         ((t.dt.minute // 15) * 15).astype(str).str.zfill(2))
        orders["time_slot_15min"] = orders["time_slot_15min"].astype(str).str.slice(0, 5)
        orders["quantity"] = orders["quantity"].astype(int)
        orders["unit_price_inr"] = orders["unit_price_inr"].astype(int)
        if "total_price_inr" not in orders.columns:
            orders["total_price_inr"] = orders["quantity"] * orders["unit_price_inr"]
        orders["total_price_inr"] = orders["total_price_inr"].astype(int)

        if menu is not None:
            menu = _map_columns_menu(menu)
        else:
            menu = (orders.sort_values("order_date").groupby("item")["unit_price_inr"].last()
                    .reset_index().rename(columns={"unit_price_inr": "price"}))

        cols = ["order_id", "order_date", "weekday", "order_time", "time_slot_15min", "item",
                "quantity", "unit_price_inr", "total_price_inr"]
        rows = list(orders[cols].itertuples(index=False, name=None))
        conn.execute("BEGIN IMMEDIATE")
        try:
            conn.execute("DELETE FROM historical_sales")
            conn.executemany(
                "INSERT INTO historical_sales (order_id,order_date,weekday,order_time,time_slot_15min,"
                "item,quantity,unit_price_inr,total_price_inr) VALUES (?,?,?,?,?,?,?,?,?)", rows)
            seeded = 0
            for item, price in menu[["item", "price"]].itertuples(index=False, name=None):
                cur = conn.execute(
                    "INSERT OR IGNORE INTO menu_items (name,category,price,image,availability) VALUES (?,?,?,?,1)",
                    (item, catalog.category_for(item), int(price), f"/static/images/{catalog.slugify(item)}.svg"))
                seeded += cur.rowcount
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
        write_images(menu["item"].tolist())
        days = orders["order_date"].nunique()
        log(f"Imported {len(rows)} historical rows over {days} days "
            f"({orders['order_date'].min()} -> {orders['order_date'].max()}); seeded {seeded} menu items.")
        return {"imported": len(rows), "days": days, "menu_items": seeded, "skipped": False}
    finally:
        conn.close()


def _map_columns_menu(menu: pd.DataFrame) -> pd.DataFrame:
    low = {str(c).strip().lower(): c for c in menu.columns}
    item = next(low[a] for a in COLUMN_ALIASES["item"] if a in low)
    price = next(low[a] for a in COLUMN_ALIASES["unit_price_inr"] + ["price"] if a in low)
    return menu.rename(columns={item: "item", price: "price"})


def write_images(names):
    settings.static_dir.joinpath("images").mkdir(parents=True, exist_ok=True)
    for n in names:
        (settings.static_dir / "images" / f"{catalog.slugify(n)}.svg").write_text(catalog.svg_for(n), encoding="utf-8")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path", nargs="?", default=str(settings.dataset_path))
    ap.add_argument("--force", action="store_true", help="reload historical_sales even if populated")
    a = ap.parse_args()
    try:
        import_dataset(Path(a.path), force=a.force)
    except Exception as exc:  # noqa: BLE001
        print(f"Import failed: {exc}", file=sys.stderr)
        sys.exit(1)
