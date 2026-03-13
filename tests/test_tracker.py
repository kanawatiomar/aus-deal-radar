from fastapi.testclient import TestClient

from app.main import app


def test_tracker_endpoint_returns_globe_routes():
    with TestClient(app) as client:
        client.post("/api/refresh")
        response = client.get("/api/tracker")
    assert response.status_code == 200
    payload = response.json()
    assert "summary" in payload
    assert "flights" in payload
    assert isinstance(payload["flights"], list)

    if payload["flights"]:
        flight = payload["flights"][0]
        assert flight["origin"] == "AUS"
        assert isinstance(flight["origin_lat"], float)
        assert isinstance(flight["destination_lon"], float)
        assert flight["kind"] in {"cash", "award"}
