# AUS Deal Radar

An Austin-first flight and points tracker with a web dashboard, local SQLite history, transfer bonus detection, and Discord DM alerts.

## What it does

- Tracks major domestic and international routes out of `AUS`
- Separates cash fares from award opportunities
- Scores deals by how far they sit below each route's rolling baseline
- Renders a 3D live alert globe for every route currently tripping the alert engine
- Looks for Amex and Capital One transfer bonus headlines from travel feeds
- Sends top deal alerts to Discord user `128587681855832064`
- Falls back to polished demo data when live API keys are missing

## Live data sources

- Cash fares: Amadeus Self-Service flight destinations API
- Award space: Seats.aero partner API cached search
- Transfer bonus headlines: configurable RSS feeds

## Quick start

1. Create a virtual environment.
2. Install dependencies with `pip install -e .[dev]`
3. Copy `.env.example` to `.env`
4. Optionally add `AMADEUS_CLIENT_ID`, `AMADEUS_CLIENT_SECRET`, `SEATS_AERO_API_KEY`, and `DISCORD_BOT_TOKEN`
5. Run `uvicorn app.main:app --reload`
6. Open [http://127.0.0.1:8000](http://127.0.0.1:8000)

## GitHub Pages

- Build a static snapshot site with `python scripts/build_github_pages.py`
- The exported Pages site lands in `docs/`
- The static site uses `docs/data/site-data.json` so filters and the 3D globe still work without the Python backend
- A Pages deploy workflow lives at `.github/workflows/deploy-pages.yml`

## Environment

- `DEMO_MODE=true` forces demo data even if live keys exist
- `AUTO_REFRESH_ON_START=true` runs an initial scan when the app boots
- `REFRESH_INTERVAL_MINUTES=180` controls the recurring scan cadence
- `ALERT_COOLDOWN_HOURS=12` prevents repeat Discord spam for the same deal

## Notes

- Amadeus uses the test environment endpoint by default in this build.
- Seats.aero program source names can vary; adjust `PARTNER_PROGRAMS` in [app/catalog.py](app/catalog.py) if you want a different transfer-partner map.
- The transfer bonus watcher is intentionally conservative and only surfaces posts that look like true Amex or Capital One transfer bonus headlines.

## Tests

Run `pytest`.
