from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import uuid4

from app.catalog import DESTINATIONS, airport_coordinates, destination_lookup
from app.config import Settings
from app.database import RadarDatabase
from app.models import (
    AwardFare,
    CashFare,
    DashboardPayload,
    RefreshReport,
    SiteDataPayload,
    TrackerFlight,
    TrackerPayload,
    TransferBonus,
)
from app.services.notifier import DiscordNotifier
from app.services.providers.amadeus import AmadeusCashProvider
from app.services.providers.bonuses import TransferBonusFeedProvider
from app.services.providers.demo import DemoDataProvider, default_demo_destinations
from app.services.providers.seats import SeatsAeroAwardProvider
from app.services.scoring import score_award, score_cash

logger = logging.getLogger(__name__)

CASH_ALERT_THRESHOLD = 68
AWARD_ALERT_THRESHOLD = 72


class DealRadarService:
    def __init__(self, settings: Settings, database: RadarDatabase):
        self.settings = settings
        self.database = database
        self.destinations = list(DESTINATIONS)
        self.demo = DemoDataProvider(settings)
        self.cash_provider = AmadeusCashProvider(settings)
        self.award_provider = SeatsAeroAwardProvider(settings)
        self.bonus_provider = TransferBonusFeedProvider(settings)
        self.notifier = DiscordNotifier(settings)

    async def ensure_bootstrap(self) -> None:
        if self.database.has_data():
            return
        await self.refresh()

    async def refresh(self) -> RefreshReport:
        batch_id = f"{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}-{uuid4().hex[:8]}"

        cash_quotes = await self._fetch_cash()
        bonuses = await self._fetch_bonuses()
        bonus_lookup = self._bonus_lookup(bonuses)
        cash_quotes = self._score_cash_quotes(cash_quotes)
        award_quotes = await self._fetch_awards()
        award_quotes = self._score_award_quotes(award_quotes, cash_quotes, bonus_lookup)

        self.database.insert_cash_quotes(batch_id, cash_quotes)
        self.database.insert_award_quotes(batch_id, award_quotes)
        self.database.replace_transfer_bonuses(batch_id, bonuses)

        sent_alerts = await self._send_alerts(cash_quotes, award_quotes)
        finished_at = datetime.now(UTC)
        self.database.insert_refresh_run(
            batch_id,
            created_at=finished_at,
            used_live_cash=any(item.provider == "amadeus" for item in cash_quotes),
            used_live_award=any(item.provider == "seats.aero" for item in award_quotes),
            cash_count=len(cash_quotes),
            award_count=len(award_quotes),
            bonus_count=len(bonuses),
            sent_alerts=sent_alerts,
        )
        return RefreshReport(
            cash_count=len(cash_quotes),
            award_count=len(award_quotes),
            bonus_count=len(bonuses),
            sent_alerts=sent_alerts,
            used_live_cash=any(item.provider == "amadeus" for item in cash_quotes),
            used_live_award=any(item.provider == "seats.aero" for item in award_quotes),
            finished_at=finished_at,
        )

    async def dashboard(
        self,
        *,
        mode: str = "both",
        bank: str = "all",
        region: str = "all",
        cabin: str = "all",
        limit: int = 18,
    ) -> DashboardPayload:
        cash_quotes = self.database.list_cash_quotes(limit=120)
        award_quotes = self.database.list_award_quotes(limit=180)
        bonuses = self.database.list_transfer_bonuses()
        latest = self.database.latest_refresh()

        filtered_cash, filtered_awards = self._apply_filters(
            cash_quotes,
            award_quotes,
            bank=bank,
            region=region,
            cabin=cabin,
        )

        radar_board: list[dict[str, object]] = []
        if mode in ("both", "cash"):
            radar_board.extend(
                [
                    {
                        "kind": "cash",
                        "title": f"{quote.city} for ${quote.price:.0f}",
                        "subtitle": f"{quote.origin}->{quote.destination} | {quote.band.upper()}",
                        "score": quote.score,
                        "detail": f"{quote.anomaly_pct:.0%} under baseline",
                        "link": quote.link,
                    }
                    for quote in filtered_cash[:8]
                ]
            )
        if mode in ("both", "award"):
            radar_board.extend(
                [
                    {
                        "kind": "award",
                        "title": f"{quote.city} for {quote.points_cost:,} pts",
                        "subtitle": f"{quote.program_display} | {quote.cabin.title()} | {quote.band.upper()}",
                        "score": quote.score,
                        "detail": f"{quote.cpp:.2f} cpp" if quote.cpp else "cash match pending",
                        "link": None,
                    }
                    for quote in filtered_awards[:8]
                ]
            )
        radar_board = sorted(radar_board, key=lambda item: float(item["score"]), reverse=True)[:10]

        summary = self._build_summary(cash_quotes, award_quotes, bonuses, latest)

        if mode == "cash":
            filtered_awards = []
        elif mode == "award":
            filtered_cash = []

        return DashboardPayload(
            summary=summary,
            radar_board=radar_board,
            cash_deals=filtered_cash[:limit],
            award_deals=filtered_awards[:limit],
            bonuses=bonuses[:8],
        )

    async def site_data(self) -> SiteDataPayload:
        cash_quotes = self.database.list_cash_quotes(limit=160)
        award_quotes = self.database.list_award_quotes(limit=220)
        bonuses = self.database.list_transfer_bonuses()
        latest = self.database.latest_refresh()
        tracker_payload = await self.tracker(mode="both", bank="all", region="all", cabin="all", limit=48)
        return SiteDataPayload(
            summary=self._build_summary(cash_quotes, award_quotes, bonuses, latest),
            cash_deals=cash_quotes,
            award_deals=award_quotes,
            bonuses=bonuses,
            tracker=tracker_payload,
        )

    async def tracker(
        self,
        *,
        mode: str = "both",
        bank: str = "all",
        region: str = "all",
        cabin: str = "all",
        limit: int = 24,
    ) -> TrackerPayload:
        cash_quotes = self.database.list_cash_quotes(limit=160)
        award_quotes = self.database.list_award_quotes(limit=220)
        filtered_cash, filtered_awards = self._apply_filters(
            cash_quotes,
            award_quotes,
            bank=bank,
            region=region,
            cabin=cabin,
        )
        alert_statuses = self.database.list_alert_statuses()

        flights: list[TrackerFlight] = []
        if mode in ("both", "cash"):
            flights.extend(
                self._tracker_flights_from_cash(
                    [quote for quote in filtered_cash if quote.score >= CASH_ALERT_THRESHOLD],
                    alert_statuses,
                )
            )
        if mode in ("both", "award"):
            flights.extend(
                self._tracker_flights_from_award(
                    [quote for quote in filtered_awards if quote.score >= AWARD_ALERT_THRESHOLD],
                    alert_statuses,
                )
            )

        flights = sorted(flights, key=lambda item: item.score, reverse=True)[:limit]
        summary = {
            "total": len(flights),
            "cash": len([item for item in flights if item.kind == "cash"]),
            "award": len([item for item in flights if item.kind == "award"]),
            "delivered": len([item for item in flights if item.status == "delivered"]),
            "live": len([item for item in flights if item.status == "live"]),
            "focus_alert_key": flights[0].alert_key if flights else None,
        }
        return TrackerPayload(summary=summary, flights=flights)

    async def _fetch_cash(self) -> list[CashFare]:
        if self.settings.live_cash_enabled and not self.settings.demo_mode:
            try:
                rows = await self.cash_provider.fetch(self.destinations)
                if rows:
                    return rows
            except Exception as exc:  # pragma: no cover
                logger.warning("Amadeus fetch failed, falling back to demo data: %s", exc)
        return await self.demo.cash(default_demo_destinations())

    async def _fetch_awards(self) -> list[AwardFare]:
        if self.settings.live_award_enabled and not self.settings.demo_mode:
            try:
                rows = await self.award_provider.fetch(self.destinations)
                if rows:
                    return rows
            except Exception as exc:  # pragma: no cover
                logger.warning("Seats.aero fetch failed, falling back to demo data: %s", exc)
        return await self.demo.awards(default_demo_destinations())

    async def _fetch_bonuses(self) -> list[TransferBonus]:
        if not self.settings.demo_mode:
            try:
                rows = await self.bonus_provider.fetch()
                if rows:
                    return rows
            except Exception as exc:  # pragma: no cover
                logger.warning("Bonus feed fetch failed, falling back to demo data: %s", exc)
        return await self.demo.bonuses()

    def _score_cash_quotes(self, quotes: list[CashFare]) -> list[CashFare]:
        meta = destination_lookup()
        scored: list[CashFare] = []
        for quote in quotes:
            fallback = meta[quote.destination].baseline_cash
            history = self.database.cash_history(quote.origin, quote.destination)
            score, anomaly_pct, baseline, band = score_cash(quote.price, history, fallback)
            scored.append(
                quote.model_copy(
                    update={
                        "score": score,
                        "anomaly_pct": anomaly_pct,
                        "baseline": baseline,
                        "band": band,
                    }
                )
            )
        return sorted(scored, key=lambda item: (item.score, -item.price), reverse=True)

    def _score_award_quotes(
        self,
        quotes: list[AwardFare],
        cash_quotes: list[CashFare],
        bonus_lookup: dict[tuple[str, str], int],
    ) -> list[AwardFare]:
        meta = destination_lookup()
        cash_reference = self._cash_reference_map(cash_quotes)
        scored: list[AwardFare] = []
        for quote in quotes:
            fallback = meta[quote.destination].baseline_awards.get(
                quote.cabin,
                meta[quote.destination].baseline_awards["economy"],
            )
            history = self.database.award_history(quote.origin, quote.destination, quote.program, quote.cabin)
            best_bonus = max((bonus_lookup.get((bank, quote.program), 0) for bank in quote.banks), default=0)
            matched_cash_reference = cash_reference.get((quote.destination, quote.departure_date.isoformat())) or cash_reference.get(
                (quote.destination, "*")
            )
            score, anomaly_pct, baseline, effective_points, cpp, band = score_award(
                quote.points_cost,
                history,
                fallback,
                matched_cash_reference,
                best_bonus,
                quote.direct,
            )
            scored.append(
                quote.model_copy(
                    update={
                        "score": score,
                        "anomaly_pct": anomaly_pct,
                        "baseline_points": baseline,
                        "effective_points_cost": effective_points,
                        "cpp": cpp,
                        "band": band,
                        "cash_reference": matched_cash_reference,
                        "bonus_percent": best_bonus,
                    }
                )
            )
        return sorted(scored, key=lambda item: (item.score, item.cpp or 0), reverse=True)

    def _cash_reference_map(self, quotes: list[CashFare]) -> dict[tuple[str, str], float]:
        lookup = {(quote.destination, quote.departure_date.isoformat()): quote.price for quote in quotes}
        for quote in quotes:
            key = (quote.destination, "*")
            lookup[key] = min(lookup.get(key, quote.price), quote.price)
        return lookup

    def _bonus_lookup(self, bonuses: list[TransferBonus]) -> dict[tuple[str, str], int]:
        lookup: dict[tuple[str, str], int] = {}
        for bonus in bonuses:
            key = (bonus.bank, bonus.program)
            lookup[key] = max(lookup.get(key, 0), bonus.bonus_percent)
        return lookup

    def _build_summary(
        self,
        cash_quotes: list[CashFare],
        award_quotes: list[AwardFare],
        bonuses: list[TransferBonus],
        latest,
    ) -> dict[str, object]:
        return {
            "origin": self.settings.origin_airport,
            "tracked_destinations": len(self.destinations),
            "cash_count": len(cash_quotes),
            "award_count": len(award_quotes),
            "bonus_count": len(bonuses),
            "live_cash": bool(latest and latest["used_live_cash"]),
            "live_award": bool(latest and latest["used_live_award"]),
            "last_refresh": latest["created_at"] if latest else None,
            "discord_target": self.settings.discord_user_id,
        }

    def _apply_filters(
        self,
        cash_quotes: list[CashFare],
        award_quotes: list[AwardFare],
        *,
        bank: str,
        region: str,
        cabin: str,
    ) -> tuple[list[CashFare], list[AwardFare]]:
        filtered_cash = [quote for quote in cash_quotes if region in ("all", quote.region)]
        filtered_awards = [
            quote
            for quote in award_quotes
            if region in ("all", quote.region)
            and bank in ("all", *quote.banks)
            and cabin in ("all", quote.cabin)
        ]
        return filtered_cash, filtered_awards

    def _tracker_flights_from_cash(
        self, quotes: list[CashFare], alert_statuses: dict[str, str]
    ) -> list[TrackerFlight]:
        flights: list[TrackerFlight] = []
        origin_coords = airport_coordinates(self.settings.origin_airport)
        if origin_coords is None:
            return flights
        origin_lat, origin_lon = origin_coords
        for quote in quotes:
            destination_coords = airport_coordinates(quote.destination)
            if destination_coords is None:
                continue
            alert_key = self._alert_key(quote)
            delivered_at = alert_statuses.get(alert_key)
            destination_lat, destination_lon = destination_coords
            flights.append(
                TrackerFlight(
                    alert_key=alert_key,
                    kind="cash",
                    status="delivered" if delivered_at else "live",
                    origin=quote.origin,
                    destination=quote.destination,
                    city=quote.city,
                    country=quote.country,
                    region=quote.region,
                    origin_lat=origin_lat,
                    origin_lon=origin_lon,
                    destination_lat=destination_lat,
                    destination_lon=destination_lon,
                    departure_date=quote.departure_date,
                    banks=[],
                    score=quote.score,
                    band=quote.band,
                    title=f"{quote.city} cash alert",
                    value_label=f"${quote.price:.0f}",
                    detail=f"{quote.anomaly_pct:.0%} under baseline",
                    provider=quote.provider,
                    delivered_at=delivered_at,
                )
            )
        return flights

    def _tracker_flights_from_award(
        self, quotes: list[AwardFare], alert_statuses: dict[str, str]
    ) -> list[TrackerFlight]:
        flights: list[TrackerFlight] = []
        origin_coords = airport_coordinates(self.settings.origin_airport)
        if origin_coords is None:
            return flights
        origin_lat, origin_lon = origin_coords
        for quote in quotes:
            destination_coords = airport_coordinates(quote.destination)
            if destination_coords is None:
                continue
            alert_key = self._alert_key(quote)
            delivered_at = alert_statuses.get(alert_key)
            destination_lat, destination_lon = destination_coords
            value_label = f"{quote.points_cost:,} pts"
            detail = quote.program_display
            if quote.cpp:
                detail = f"{quote.program_display} | {quote.cpp:.2f} cpp"
            flights.append(
                TrackerFlight(
                    alert_key=alert_key,
                    kind="award",
                    status="delivered" if delivered_at else "live",
                    origin=quote.origin,
                    destination=quote.destination,
                    city=quote.city,
                    country=quote.country,
                    region=quote.region,
                    origin_lat=origin_lat,
                    origin_lon=origin_lon,
                    destination_lat=destination_lat,
                    destination_lon=destination_lon,
                    departure_date=quote.departure_date,
                    cabin=quote.cabin,
                    banks=quote.banks,
                    score=quote.score,
                    band=quote.band,
                    title=f"{quote.city} award alert",
                    value_label=value_label,
                    detail=detail,
                    provider=quote.provider,
                    delivered_at=delivered_at,
                )
            )
        return flights

    async def _send_alerts(self, cash_quotes: list[CashFare], award_quotes: list[AwardFare]) -> int:
        sent = 0
        candidates = [
            *[quote for quote in cash_quotes if quote.score >= CASH_ALERT_THRESHOLD][:2],
            *[quote for quote in award_quotes if quote.score >= AWARD_ALERT_THRESHOLD][:2],
        ]
        for quote in candidates:
            key = self._alert_key(quote)
            if self.database.alert_recently_sent(key, self.settings.alert_cooldown_hours):
                continue
            delivered = await self.notifier.send(self._format_alert(quote))
            if delivered:
                self.database.record_alert(key, quote.deal_type, quote.model_dump(mode="json"))
                sent += 1
        return sent

    @staticmethod
    def _alert_key(quote: CashFare | AwardFare) -> str:
        if isinstance(quote, CashFare):
            return f"cash:{quote.route_key}:{quote.departure_date}:{quote.price:.0f}"
        return f"award:{quote.route_key}:{quote.departure_date}:{quote.cabin}:{quote.program}:{quote.points_cost}"

    @staticmethod
    def _format_alert(quote: CashFare | AwardFare) -> str:
        if isinstance(quote, CashFare):
            baseline = f"${quote.baseline:.0f}" if quote.baseline else "route baseline"
            return (
                f"Hot cash fare from {quote.origin} to {quote.city} ({quote.destination})\n"
                f"${quote.price:.0f} on {quote.departure_date.isoformat()}.\n"
                f"{quote.anomaly_pct:.0%} under baseline vs {baseline}. Grade: {quote.band.upper()}."
            )
        cpp = f"{quote.cpp:.2f} cpp" if quote.cpp else "cash match pending"
        bonus = f" with {quote.bonus_percent}% bonus" if quote.bonus_percent else ""
        return (
            f"Award sweet spot from {quote.origin} to {quote.city} ({quote.destination})\n"
            f"{quote.points_cost:,} {quote.program_display} points for {quote.cabin}{bonus}.\n"
            f"{cpp}. Grade: {quote.band.upper()}."
        )
