from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.main import app, opensky
from app.models import LiveAircraftBounds, LiveAircraftPayload, LiveAircraftState


def test_live_aircraft_endpoint_returns_normalized_payload(monkeypatch):
    payload = LiveAircraftPayload(
        fetched_at=datetime(2026, 3, 13, 22, 0, tzinfo=UTC),
        source="opensky",
        authenticated=False,
        bounds=LiveAircraftBounds(
            preset="north_america",
            label="North America live traffic",
            lamin=14.0,
            lomin=-170.0,
            lamax=72.0,
            lomax=-52.0,
        ),
        total_states=1,
        airborne_count=1,
        aircraft=[
            LiveAircraftState(
                icao24="abc123",
                callsign="AUS101",
                origin_country="United States",
                longitude=-97.6699,
                latitude=30.1945,
                baro_altitude_m=10300,
                geo_altitude_m=10420,
                altitude_m=10420,
                velocity_mps=236,
                heading_deg=78,
                vertical_rate_mps=0.0,
                on_ground=False,
                last_contact=1773444000,
                last_position_update=1773443994,
                category=0,
            )
        ],
    )

    async def fake_snapshot(preset="world", include_on_ground=False):
        assert preset == "north_america"
        assert include_on_ground is True
        return payload

    monkeypatch.setattr(opensky, "snapshot", fake_snapshot)

    with TestClient(app) as client:
        response = client.get("/api/live-aircraft?preset=north_america&include_on_ground=true")

    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "opensky"
    assert body["bounds"]["preset"] == "north_america"
    assert body["airborne_count"] == 1
    assert body["aircraft"][0]["callsign"] == "AUS101"
    assert body["aircraft"][0]["heading_deg"] == 78.0
