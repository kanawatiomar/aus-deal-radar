from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from random import Random

from app.catalog import DESTINATIONS, PARTNER_PROGRAMS, DestinationMeta
from app.config import Settings
from app.models import AwardFare, CashFare, TransferBonus


class DemoDataProvider:
    name = "demo-radar"

    def __init__(self, settings: Settings):
        self.settings = settings
        self.random = Random(48)

    async def cash(self, destinations: list[DestinationMeta]) -> list[CashFare]:
        now = datetime.now(UTC)
        quotes: list[CashFare] = []
        for index, destination in enumerate(destinations):
            depart = date.today() + timedelta(days=7 + index * 2)
            length = self.random.randint(self.settings.trip_min_days, self.settings.trip_max_days)
            if index % 6 == 0:
                multiplier = 0.38
            elif index % 7 == 0:
                multiplier = 0.52
            else:
                multiplier = 0.82 + (index % 5) * 0.03
            price = destination.baseline_cash * multiplier
            quotes.append(
                CashFare(
                    origin=self.settings.origin_airport,
                    destination=destination.code,
                    city=destination.city,
                    country=destination.country,
                    region=destination.region,
                    departure_date=depart,
                    return_date=depart + timedelta(days=length),
                    price=round(price, 2),
                    direct=index % 3 != 0,
                    carriers=["AA", "DL", "UA", "B6"][index % 4],
                    provider=self.name,
                    link=f"https://example.com/flights/{self.settings.origin_airport}-{destination.code}",
                    observed_at=now,
                    raw={"demo": True},
                )
            )
        return quotes

    async def awards(self, destinations: list[DestinationMeta]) -> list[AwardFare]:
        now = datetime.now(UTC)
        rows: list[AwardFare] = []
        program_keys = list(PARTNER_PROGRAMS.keys())
        cabins = ["economy", "business"]
        for index, destination in enumerate(destinations[:24]):
            program = program_keys[index % len(program_keys)]
            program_info = PARTNER_PROGRAMS[program]
            cabin = cabins[index % len(cabins)]
            base = destination.baseline_awards[cabin]
            if index % 5 == 0:
                multiplier = 0.44
            elif index % 6 == 0:
                multiplier = 0.58
            else:
                multiplier = 0.82 + (index % 4) * 0.04
            points = int(base * multiplier)
            rows.append(
                AwardFare(
                    origin=self.settings.origin_airport,
                    destination=destination.code,
                    city=destination.city,
                    country=destination.country,
                    region=destination.region,
                    departure_date=date.today() + timedelta(days=7 + index * 2),
                    cabin=cabin,
                    program=program,
                    program_display=str(program_info["name"]),
                    banks=list(program_info["banks"]),
                    points_cost=points,
                    effective_points_cost=float(points),
                    direct=index % 4 != 0,
                    carriers=["AA", "DL", "UA", "AF", "BA", "NH"][index % 6],
                    provider=self.name,
                    observed_at=now,
                    bonus_percent=20 if index % 8 == 0 else 0,
                    raw={"demo": True},
                )
            )
        return rows

    async def bonuses(self) -> list[TransferBonus]:
        now = datetime.now(UTC)
        return [
            TransferBonus(
                bank="amex",
                program="flyingblue",
                program_display="Flying Blue",
                bonus_percent=20,
                headline="20% Amex transfer bonus spotted for Flying Blue",
                url="https://example.com/amex-flying-blue",
                observed_at=now,
                source="demo-feed",
            ),
            TransferBonus(
                bank="capital_one",
                program="virginatlantic",
                program_display="Virgin Atlantic Flying Club",
                bonus_percent=30,
                headline="30% Capital One bonus can juice Virgin Atlantic bookings",
                url="https://example.com/c1-virgin",
                observed_at=now,
                source="demo-feed",
            ),
        ]


def default_demo_destinations() -> list[DestinationMeta]:
    return list(DESTINATIONS)
