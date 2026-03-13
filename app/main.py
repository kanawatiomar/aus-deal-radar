from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, Query, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.config import get_settings
from app.database import RadarDatabase
from app.services.opensky import OpenSkyService
from app.services.radar import DealRadarService


settings = get_settings()
database = RadarDatabase(settings.database_path)
database.init()
radar = DealRadarService(settings, database)
opensky = OpenSkyService(settings)
scheduler = AsyncIOScheduler(timezone=settings.timezone)

BASE_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(BASE_DIR / "web" / "templates"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.auto_refresh_on_start:
        await radar.ensure_bootstrap()
    scheduler.add_job(
        radar.refresh,
        "interval",
        minutes=settings.refresh_interval_minutes,
        id="market-refresh",
        replace_existing=True,
    )
    scheduler.start()
    app.state.radar = radar
    app.state.opensky = opensky
    yield
    scheduler.shutdown(wait=False)
    await opensky.close()


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "web" / "static")), name="static")


@app.get("/", response_class=HTMLResponse)
async def index(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(
        name="index.html",
        request=request,
        context={
            "request": request,
            "app_name": settings.app_name,
            "origin": settings.origin_airport,
            "discord_user_id": settings.discord_user_id,
        },
    )


@app.get("/api/dashboard")
async def dashboard(
    mode: str = Query(default="both", pattern="^(both|cash|award)$"),
    bank: str = Query(default="all"),
    region: str = Query(default="all", pattern="^(all|domestic|international)$"),
    cabin: str = Query(default="all", pattern="^(all|economy|premium|business|first)$"),
    limit: int = Query(default=18, ge=4, le=40),
):
    return await radar.dashboard(mode=mode, bank=bank, region=region, cabin=cabin, limit=limit)


@app.get("/api/site-data")
async def site_data():
    return await radar.site_data()


@app.get("/api/tracker")
async def tracker(
    mode: str = Query(default="both", pattern="^(both|cash|award)$"),
    bank: str = Query(default="all"),
    region: str = Query(default="all", pattern="^(all|domestic|international)$"),
    cabin: str = Query(default="all", pattern="^(all|economy|premium|business|first)$"),
    limit: int = Query(default=24, ge=4, le=60),
):
    return await radar.tracker(mode=mode, bank=bank, region=region, cabin=cabin, limit=limit)


@app.get("/api/live-aircraft")
async def live_aircraft(
    preset: str = Query(default="world", pattern="^(world|north_america|austin_corridor)$"),
    include_on_ground: bool = False,
):
    return await opensky.snapshot(preset=preset, include_on_ground=include_on_ground)


@app.post("/api/refresh")
async def refresh():
    return await radar.refresh()


@app.get("/api/health")
async def health():
    latest = database.latest_refresh()
    return {
        "ok": True,
        "origin": settings.origin_airport,
        "last_refresh": latest["created_at"] if latest else None,
    }
