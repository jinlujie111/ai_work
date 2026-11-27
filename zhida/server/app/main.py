import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .db import SessionLocal, init_db
from .market_service import normalize_existing_domains, seed_market_if_empty
from .routers import (
    admin_ops,
    auth,
    calendar,
    goals,
    groups,
    market,
    me,
    plans,
    reviews,
    skills,
    tasks,
)

logger = logging.getLogger("zhida")


def _configure_logging() -> None:
    if logging.getLogger().handlers:
        return
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _configure_logging()
    settings = get_settings()
    settings.validate_startup()
    init_db()
    db = SessionLocal()
    try:
        seed_market_if_empty(db)
        normalize_existing_domains(db)
    finally:
        db.close()
    logger.info("startup ok app_env=%s", settings.app_env)
    yield


settings = get_settings()
origins = settings.cors_origin_list()
# credentials + "*" 组合在浏览器侧无效；通配时关闭 credentials
allow_credentials = origins != ["*"]

app = FastAPI(title="学习者 API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(me.router)
app.include_router(goals.router)
app.include_router(tasks.router)
app.include_router(plans.router)
app.include_router(reviews.router)
app.include_router(skills.router)
app.include_router(calendar.router)
app.include_router(groups.router)
app.include_router(groups.templates_router)
app.include_router(groups.goal_share_router)
app.include_router(market.router)
app.include_router(admin_ops.router)

_WEB_DIR = Path(__file__).resolve().parents[2] / "web"
if _WEB_DIR.is_dir():
    app.mount("/ops", StaticFiles(directory=str(_WEB_DIR), html=True), name="ops-web")


@app.middleware("http")
async def request_logging(request: Request, call_next):
    started = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    user_id = getattr(request.state, "user_id", None)
    logger.info(
        "%s %s -> %s %sms user=%s",
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
        user_id if user_id is not None else "-",
    )
    return response


@app.get("/health")
def health():
    return {"ok": True, "service": "zhida", "app_env": get_settings().app_env}
