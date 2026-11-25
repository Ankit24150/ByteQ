"""Configuration, read from environment variables / backend/.env."""
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
ROOT_DIR = BACKEND_DIR.parent


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


_load_env_file(BACKEND_DIR / ".env")


def _path(value: str) -> Path:
    p = Path(value)
    return p if p.is_absolute() else (BACKEND_DIR / p).resolve()


class Settings:
    db_path = _path(os.environ.get("CANTEEN_DB", "./canteen.db"))
    slot_capacity = int(os.environ.get("SLOT_CAPACITY", "50"))
    slot_start_hour = int(os.environ.get("SLOT_START_HOUR", "11"))
    slot_end_hour = int(os.environ.get("SLOT_END_HOUR", "15"))
    enforce_past_slots = os.environ.get("ENFORCE_PAST_SLOTS", "false").lower() == "true"
    filling_fast_ratio = 0.7
    cors_origins = [o.strip() for o in os.environ.get(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]
    dataset_path = _path(os.environ.get("DATASET_PATH", "../data/canteen_fake_data_30_days.xlsx"))
    static_dir = BACKEND_DIR / "static"
    frontend_dist = ROOT_DIR / "frontend" / "dist"


settings = Settings()
