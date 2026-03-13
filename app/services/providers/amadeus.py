from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import httpx

from app.catalog import destination_lookup, DestinationMeta
from app.config import Settings
from app.models import CashFare


class AmadeusCashProvider:
    name = "amadeus"

    def __init__(self, settings: Settings):
        self.settings = settings
        self._token: str | None = None
        self._token_expires_at: datetime | None = None

    async def fetch(self, destinations: list[DestinationMeta]) -> list[CashFare]:
        token = await self._access_token()
        today = date.today()
        params = {
            "origin": self.settings.origin_airport,
            "departureDate": f"{(today + timedelta(days=14)).isoformat()},{(today + timedelta(days=self.settings.lookahead_days)).isoformat()}",
            "oneWay": "false",
            "duration": f"{self.settings.trip_min_days},{self.settings.trip_max_days}",
            "currency": "USD",
            "maxPrice": "2500",
            "viewBy": "DATE",
        }
        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                "https://test.api.amadeus.com/v1/shopping/flight-destinations",
                headers=headers,
                params=params,
            )
            response.raise_for_status()
            payload = response.json()

        meta = destination_lookup()
        wanted = {item.code for item in destinations}
        rows: list[CashFare] = []
        observed_at = datetime.now(UTC)
        for item in payload.get("data", []):
            destination = (item.get("destination") or item.get("destinationLocationCode") or "").upper()
            if destination not in wanted or destination not in meta:
                continue
            details = meta[destination]
            price_block = item.get("price", {})
            links = item.get("links", {})
            departure = item.get("departureDate")
            if not destination or not departure or "total" not in price_block:
                continue
            return_date = item.get("returnDate")
            rows.append(
                CashFare(
                    origin=self.settings.origin_airport,
                    destination=destination,
                    city=details.city,
                    country=details.country,
                    region=details.region,
                    departure_date=departure,
                    return_date=return_date,
                    price=float(price_block["total"]),
                    currency=price_block.get("currency", "USD"),
                    direct=None,
                    carriers=None,
                    provider=self.name,
                    link=links.get("flightOffers"),
                    observed_at=observed_at,
                    raw=item,
                )
            )
        return rows

    async def _access_token(self) -> str:
        now = datetime.now(UTC)
        if self._token and self._token_expires_at and now < self._token_expires_at:
            return self._token

        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                "https://test.api.amadeus.com/v1/security/oauth2/token",
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.settings.amadeus_client_id,
                    "client_secret": self.settings.amadeus_client_secret,
                },
            )
            response.raise_for_status()
            payload = response.json()

        self._token = payload["access_token"]
        expires_in = int(payload.get("expires_in", 1799))
        self._token_expires_at = now + timedelta(seconds=max(60, expires_in - 60))
        return self._token
