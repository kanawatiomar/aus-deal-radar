from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import httpx

from app.catalog import PARTNER_PROGRAMS, destination_lookup, DestinationMeta
from app.config import Settings
from app.models import AwardFare


CABIN_MAP = {
    "Y": "economy",
    "W": "premium",
    "J": "business",
    "F": "first",
}


class SeatsAeroAwardProvider:
    name = "seats.aero"

    def __init__(self, settings: Settings):
        self.settings = settings

    async def fetch(self, destinations: list[DestinationMeta]) -> list[AwardFare]:
        today = date.today()
        params = {
            "origin_airport": self.settings.origin_airport,
            "destination_airport": ",".join(item.code for item in destinations),
            "start_date": (today + timedelta(days=3)).isoformat(),
            "end_date": (today + timedelta(days=self.settings.lookahead_days)).isoformat(),
            "take": self.settings.seats_aero_take,
            "order_by": "lowest_mileage",
            "sources": ",".join(sorted(PARTNER_PROGRAMS.keys())),
        }
        headers = {"Partner-Authorization": self.settings.seats_aero_api_key or ""}
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get("https://seats.aero/partnerapi/search", params=params, headers=headers)
            response.raise_for_status()
            payload = response.json()

        meta = destination_lookup()
        observed_at = datetime.now(UTC)
        quotes: list[AwardFare] = []
        for item in payload.get("data", []):
            route = item.get("Route", {}) or {}
            destination = (
                item.get("DestinationAirport")
                or route.get("DestinationAirport")
                or item.get("destination_airport")
                or ""
            ).upper()
            source = (item.get("Source") or route.get("Source") or "").lower()
            departure_date = item.get("Date") or item.get("departure_date")
            if destination not in meta or source not in PARTNER_PROGRAMS or not departure_date:
                continue

            details = meta[destination]
            partner = PARTNER_PROGRAMS[source]
            for code, cabin in CABIN_MAP.items():
                available = item.get(f"{code}Available")
                mileage = item.get(f"{code}MileageCost")
                if not available or not mileage or str(mileage) == "0":
                    continue
                carriers = item.get(f"{code}Airlines")
                direct = item.get(f"{code}Direct")
                quotes.append(
                    AwardFare(
                        origin=self.settings.origin_airport,
                        destination=destination,
                        city=details.city,
                        country=details.country,
                        region=details.region,
                        departure_date=departure_date,
                        cabin=cabin,
                        program=source,
                        program_display=str(partner["name"]),
                        banks=list(partner["banks"]),
                        points_cost=int(mileage),
                        direct=None if direct is None else bool(direct),
                        carriers=carriers,
                        provider=self.name,
                        observed_at=observed_at,
                        raw=item,
                    )
                )

        return quotes
