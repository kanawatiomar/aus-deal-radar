from __future__ import annotations

import asyncio
import json
import subprocess
import shutil
from pathlib import Path

from app.config import get_settings
from app.database import RadarDatabase
from app.services.opensky import OpenSkyService
from app.services.radar import DealRadarService


ROOT = Path(__file__).resolve().parents[1]
DOCS_DIR = ROOT / "docs"
ASSETS_DIR = DOCS_DIR / "assets"
DATA_DIR = DOCS_DIR / "data"


HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AUS Deal Radar</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="./assets/styles.css">
  <link rel="stylesheet" href="./assets/flight-tracker/flight-tracker.css">
</head>
<body>
  <div class="backdrop"></div>
  <main class="shell">
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">Austin Deal Radar</p>
        <h1>Flight steals, award sweet spots, and transfer bonus juice from AUS.</h1>
        <p class="lede">
          Tracks major domestic and international routes out of Austin, separates cash from award space,
          and lines up Amex plus Capital One redemptions before the deals fade.
        </p>
        <div class="hero-actions">
          <button id="refreshButton" class="primary">Snapshot Mode</button>
          <span class="discord-pill">Discord target: 128587681855832064</span>
        </div>
      </div>
      <div class="hero-panel">
        <div class="panel-label">Flight Board</div>
        <div class="hero-metrics" id="heroMetrics">
          <article><span>Cash</span><strong>--</strong></article>
          <article><span>Awards</span><strong>--</strong></article>
          <article><span>Bonuses</span><strong>--</strong></article>
          <article><span>Last Sweep</span><strong>Loading</strong></article>
        </div>
      </div>
    </section>

    <section class="globe-section">
      <div class="section-head">
        <h2>Live Flight Earth</h2>
        <p>Real-time OpenSky aircraft traffic on a rotatable 3D Earth with altitude-aware motion.</p>
      </div>
      <div id="liveFlightTrackerRoot"></div>
    </section>

    <section class="filters">
      <div class="filter-group">
        <label for="modeFilter">View</label>
        <select id="modeFilter">
          <option value="both">Cash + Award</option>
          <option value="cash">Cash Only</option>
          <option value="award">Award Only</option>
        </select>
      </div>
      <div class="filter-group">
        <label for="bankFilter">Bank</label>
        <select id="bankFilter">
          <option value="all">All</option>
          <option value="amex">Amex</option>
          <option value="capital_one">Capital One</option>
        </select>
      </div>
      <div class="filter-group">
        <label for="regionFilter">Region</label>
        <select id="regionFilter">
          <option value="all">All</option>
          <option value="domestic">Domestic</option>
          <option value="international">International</option>
        </select>
      </div>
      <div class="filter-group">
        <label for="cabinFilter">Cabin</label>
        <select id="cabinFilter">
          <option value="all">All</option>
          <option value="economy">Economy</option>
          <option value="premium">Premium</option>
          <option value="business">Business</option>
          <option value="first">First</option>
        </select>
      </div>
    </section>

    <section class="radar-section">
      <div class="section-head">
        <h2>Radar Board</h2>
        <p>Top anomalies across cash and award pricing.</p>
      </div>
      <div id="radarBoard" class="radar-grid"></div>
    </section>

    <section class="data-grid">
      <article class="table-card">
        <div class="section-head compact">
          <h2>Cash Tracker</h2>
          <p>Abnormally low fares from Austin.</p>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Route</th><th>Dates</th><th>Price</th><th>Signal</th></tr>
            </thead>
            <tbody id="cashTable"></tbody>
          </table>
        </div>
      </article>

      <article class="table-card">
        <div class="section-head compact">
          <h2>Award Tracker</h2>
          <p>Best point value inside Amex and Capital One ecosystems.</p>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Route</th><th>Program</th><th>Cost</th><th>Value</th></tr>
            </thead>
            <tbody id="awardTable"></tbody>
          </table>
        </div>
      </article>
    </section>

    <section class="bonus-strip">
      <div class="section-head">
        <h2>Transfer Bonus Wire</h2>
        <p>Recent Amex and Capital One bonus headlines caught by the feed watcher.</p>
      </div>
      <div id="bonusList" class="bonus-list"></div>
    </section>
  </main>
  <script src="./config.js"></script>
  <script type="module" src="./assets/flight-tracker/flight-tracker.js"></script>
  <script src="./assets/app.js"></script>
</body>
</html>
"""


CONFIG_JS = """window.DASHBOARD_CONFIG = {
  endpoints: {
    siteData: "./data/site-data.json"
  },
  refreshEnabled: false,
  pollMs: 0
};
window.FLIGHT_TRACKER_CONFIG = {
  sourceMode: "direct",
  endpoint: null,
  snapshotEndpoint: "./data/live-aircraft.json",
  directUrl: "https://opensky-network.org/api/states/all",
  defaultPreset: "world",
  pollMs: 20000,
  includeOnGround: false
};
"""


async def export_snapshot() -> dict:
    settings = get_settings()
    snapshot_db = ROOT / "data" / "github-pages-snapshot.db"
    if snapshot_db.exists():
        snapshot_db.unlink()

    database = RadarDatabase(snapshot_db)
    database.init()
    radar = DealRadarService(settings, database)
    await radar.refresh()
    payload = await radar.site_data()
    return payload.model_dump(mode="json")


async def export_live_aircraft() -> dict:
    settings = get_settings()
    service = OpenSkyService(settings)
    try:
        payload = await service.snapshot(preset="world")
    finally:
        await service.close()
    return payload.model_dump(mode="json")


def build_frontend_assets() -> None:
    npm_executable = shutil.which("npm") or shutil.which("npm.cmd")
    if not npm_executable:
        raise FileNotFoundError("npm was not found in PATH. Run npm install --prefix frontend first.")
    subprocess.run(
        [npm_executable, "run", "build", "--prefix", "frontend"],
        cwd=ROOT,
        check=True,
    )


def copy_assets() -> None:
    shutil.copy2(ROOT / "app" / "web" / "static" / "styles.css", ASSETS_DIR / "styles.css")
    shutil.copy2(ROOT / "app" / "web" / "static" / "app.js", ASSETS_DIR / "app.js")
    tracker_source = ROOT / "app" / "web" / "static" / "flight-tracker"
    tracker_target = ASSETS_DIR / "flight-tracker"
    tracker_target.mkdir(parents=True, exist_ok=True)
    shutil.copytree(tracker_source, tracker_target, dirs_exist_ok=True)


async def main() -> None:
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    build_frontend_assets()
    snapshot, live_aircraft = await asyncio.gather(
        export_snapshot(),
        export_live_aircraft(),
    )
    copy_assets()

    (DOCS_DIR / "index.html").write_text(HTML_TEMPLATE, encoding="utf-8")
    (DOCS_DIR / "config.js").write_text(CONFIG_JS, encoding="utf-8")
    (DOCS_DIR / ".nojekyll").write_text("", encoding="utf-8")
    (DATA_DIR / "site-data.json").write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
    (DATA_DIR / "live-aircraft.json").write_text(json.dumps(live_aircraft, indent=2), encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main())
