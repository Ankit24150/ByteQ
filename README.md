# BiteQ – Smart Canteen Ordering & Queue Management

Students order online and pick a 15‑minute pickup slot; the kitchen sees orders live; admins get analytics
from the **existing 30‑day dataset** (`data/canteen_fake_data_30_days.xlsx`, read‑only, never regenerated).

**Stack:** React 18 + Tailwind + Recharts + Lucide (Vite) · Python FastAPI · SQLite.

## Run locally

Requires Python 3.10+ and Node 18+.

```bash
# 1. Backend (terminal 1)
cd backend
pip install -r requirements.txt
cp .env.example .env            # optional
python import_dataset.py        # optional: the server also auto-imports on first start
python -m uvicorn app.main:app --port 8000

# 2. Frontend (terminal 2)
cd frontend
npm install
npm run dev                     # http://localhost:5173  (proxies /api to :8000)
```

**Single-port demo mode:** `cd frontend && npm install && npm run build`, then start only the backend –
it serves the built app at http://localhost:8000.

## Deploy

The frontend is hosted on Vercel and the FastAPI backend on Render. The backend needs persistent storage
because it writes orders to SQLite; the Render blueprint provisions a persistent disk (Render's Starter
web service plan is paid).

1. In Vercel, import this GitHub repository and set **Root Directory** to `frontend`.
   Vercel detects Vite; use `npm run build` and `dist` if prompted.
2. Deploy the backend using the repository's `render.yaml` blueprint. When prompted for `CORS_ORIGINS`,
   enter the Vercel production origin, for example `https://your-project.vercel.app` (no trailing slash).
   Add any other origins you want to permit as comma-separated values.
3. In Vercel project settings, add `VITE_API_URL` with the Render backend's public origin, for example
   `https://biteq-api.onrender.com` (no trailing slash), then redeploy the frontend.

The backend imports the historical dataset at startup. Check `https://<your-backend>/api/health` to verify
it is running. Vercel preview deployments use different origins; add them to `CORS_ORIGINS` if they need
to call the backend.

| Interface | URL |
|---|---|
| Student | `/` (track orders at `/track`) |
| Kitchen | `/kitchen` |
| Admin / Analytics | `/admin` (Historical dataset tab + Live orders tab) |
| API docs (Swagger) | http://localhost:8000/docs |

## Tests
```bash
cd backend && pytest -v
```
Starts a real server on a temp DB and covers all 12 required scenarios, including 40 simultaneous orders against a
10‑seat slot (exactly 10 succeed).

## Judges' full‑slot demo
1. Open `/`, add food, pick **1:00–1:15 PM**, confirm – repeat until 10 orders (capacity 10; changeable via
   `SLOT_CAPACITY` in `.env` or `PATCH /api/slots/{id}`).
2. The 11th order is rejected by the backend (HTTP 409 `SLOT_FULL`) with a message and a one‑click switch to the next
   available slot. The slot shows **Full** on the live queue meter.
3. Cancel an order (student page or kitchen) → capacity is released.
4. `/admin` → Live orders → **Reset live demo data** clears live orders only (historical data untouched).

## Dataset import
`backend/import_dataset.py [file.xlsx|csv] [--force]` – maps columns via aliases, copies every row verbatim into
`historical_sales` (5,078 rows), seeds `menu_items` from the Menu sheet. The dataset has no categories/images, so
categories (Snacks/Meals/Beverages/Fast Food) are assigned in `app/catalog.py` and food images are generated emoji
illustrations (`backend/static/images`). Idempotent; the source file is never modified.

## API
All errors: `{"detail": {"code", "message", ...}}`.

| Endpoint | Purpose |
|---|---|
| `GET /api/menu` (`?category&q&available_only`) | Menu with `available` flag |
| `PATCH /api/menu/{id}` | Toggle availability / price |
| `GET /api/slots` | Slots with remaining capacity, status (Available / Filling Fast / Full), smart `recommended` flag, `best_slot` |
| `PATCH /api/slots/{id}` | Change capacity |
| `POST /api/orders` | Validate, atomic slot reservation, returns order ID + pickup time. 409 `SLOT_FULL` (with `suggested_slot`), 409 `ITEM_UNAVAILABLE`, 404, 422 |
| `GET /api/orders` | Kitchen list (today, sorted by pickup; `status`, `active_only`, `slot_id`, `date`) |
| `GET /api/orders/{id}` | Order detail, queue position |
| `PATCH /api/orders/{id}/status` | Pending→Accepted→Preparing→Ready for Pickup→Completed; Cancelled releases capacity |
| `GET /api/kitchen/prep-summary` | Total quantity per item to prepare, cooking queue |
| `GET /api/analytics/peak-slots · top-items · daily-sales · recommendations · demand · summary` | From the historical dataset |
| `GET /api/analytics/live` | Live app orders (kept separate) |
| `GET /api/combos` | Combo of the day |
| `POST /api/admin/reset-live` | Demo reset of live orders |

## Design notes / defaults
- **Concurrency:** `BEGIN IMMEDIATE` plus `UPDATE … WHERE booked_count < capacity`, and a DB `CHECK (booked_count <= capacity)`.
- **Slots:** 11:00–15:00 (matches dataset hours), created per day on demand. Past slots remain bookable so the demo works
  at any time of day; set `ENFORCE_PAST_SLOTS=true` to close them.
- **Filling Fast** = ≥70% booked. **Smart pickup** score = 65% live occupancy + 35% historical busyness.
- **Cook‑ahead:** average units for that weekday × (1 + 10% buffer, ±5% for 7‑day trend; no buffer for low‑demand items), with
  explanation, peak slot and "cook by" time. Demand levels = top/bottom third by units sold.
- **Combos:** built from top‑selling items for the weekday; price = sum of menu prices. (Dataset has one item per order, so
  co‑purchase pairing is not derivable.)
- **Real-time:** polling (3–5 s). Payments are simulated / cash on pickup. No auth (prototype).
