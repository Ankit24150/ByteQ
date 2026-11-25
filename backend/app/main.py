import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .db import init_db
from . import routes_analytics, routes_orders, routes_student

log = logging.getLogger("canteen")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # first run: auto-import the dataset if the table is empty (original file is only read)
    try:
        from import_dataset import import_dataset
        import_dataset(settings.dataset_path, verbose=False)
    except Exception as exc:  # noqa: BLE001
        log.warning("Dataset auto-import skipped: %s", exc)
    yield


app = FastAPI(title="Smart Canteen API", version="1.0.0", lifespan=lifespan,
              description="Online ordering, pickup-slot management, kitchen & analytics for a college canteen.")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(HTTPException)
async def http_exc(_: Request, exc: HTTPException):
    d = exc.detail if isinstance(exc.detail, dict) else {"code": f"HTTP_{exc.status_code}", "message": str(exc.detail)}
    return JSONResponse({"detail": d}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_exc(_: Request, exc: RequestValidationError):
    errs = [{"field": ".".join(str(p) for p in e["loc"][1:]), "message": e["msg"]} for e in exc.errors()]
    msg = "; ".join(f"{e['field']}: {e['message']}" if e["field"] else e["message"] for e in errs)
    return JSONResponse({"detail": {"code": "VALIDATION_ERROR", "message": f"Invalid request - {msg}", "errors": errs}},
                        status_code=422)


@app.get("/api/health", tags=["meta"])
def health():
    return {"status": "ok"}


app.include_router(routes_student.router)
app.include_router(routes_orders.router)
app.include_router(routes_analytics.router)

settings.static_dir.joinpath("images").mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=settings.static_dir), name="static")

if settings.frontend_dist.exists():  # production mode: serve the built React app from the same port
    app.mount("/assets", StaticFiles(directory=settings.frontend_dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "Not found")
        f = settings.frontend_dist / path
        return FileResponse(f if path and f.is_file() else settings.frontend_dist / "index.html")
