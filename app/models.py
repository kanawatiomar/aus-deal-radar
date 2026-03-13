from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class CashFare(BaseModel):
    deal_type: Literal["cash"] = "cash"
    origin: str
    destination: str
    city: str
    country: str
    region: str
    departure_date: date
    return_date: date | None = None
    price: float
    currency: str = "USD"
    direct: bool | None = None
    carriers: str | None = None
    provider: str
    link: str | None = None
    observed_at: datetime
    score: float = 0.0
    band: str = "watch"
    anomaly_pct: float = 0.0
    baseline: float | None = None
    raw: dict[str, Any] = Field(default_factory=dict)

    @property
    def route_key(self) -> str:
        return f"{self.origin}-{self.destination}"


class AwardFare(BaseModel):
    deal_type: Literal["award"] = "award"
    origin: str
    destination: str
    city: str
    country: str
    region: str
    departure_date: date
    cabin: str
    program: str
    program_display: str
    banks: list[str]
    points_cost: int
    effective_points_cost: float | None = None
    direct: bool | None = None
    carriers: str | None = None
    provider: str
    observed_at: datetime
    score: float = 0.0
    band: str = "watch"
    anomaly_pct: float = 0.0
    baseline_points: float | None = None
    cash_reference: float | None = None
    cpp: float | None = None
    bonus_percent: int = 0
    raw: dict[str, Any] = Field(default_factory=dict)

    @property
    def route_key(self) -> str:
        return f"{self.origin}-{self.destination}"


class TransferBonus(BaseModel):
    bank: str
    program: str
    program_display: str
    bonus_percent: int
    headline: str
    url: str
    observed_at: datetime
    source: str


class RefreshReport(BaseModel):
    cash_count: int
    award_count: int
    bonus_count: int
    sent_alerts: int
    used_live_cash: bool
    used_live_award: bool
    finished_at: datetime


class DashboardPayload(BaseModel):
    summary: dict[str, Any]
    radar_board: list[dict[str, Any]]
    cash_deals: list[CashFare]
    award_deals: list[AwardFare]
    bonuses: list[TransferBonus]


class TrackerFlight(BaseModel):
    alert_key: str
    kind: Literal["cash", "award"]
    status: Literal["live", "delivered"]
    origin: str
    destination: str
    city: str
    country: str
    region: str
    origin_lat: float
    origin_lon: float
    destination_lat: float
    destination_lon: float
    departure_date: date
    cabin: str | None = None
    banks: list[str] = Field(default_factory=list)
    score: float
    band: str
    title: str
    value_label: str
    detail: str
    provider: str
    delivered_at: datetime | None = None


class TrackerPayload(BaseModel):
    summary: dict[str, Any]
    flights: list[TrackerFlight]


class SiteDataPayload(BaseModel):
    summary: dict[str, Any]
    cash_deals: list[CashFare]
    award_deals: list[AwardFare]
    bonuses: list[TransferBonus]
    tracker: TrackerPayload
