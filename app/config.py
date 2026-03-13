from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "AUS Deal Radar"
    timezone: str = "America/Denver"
    origin_airport: str = "AUS"

    data_dir: Path = Path("data")
    database_path: Path = Path("data/radar.db")

    lookahead_days: int = 120
    trip_min_days: int = 3
    trip_max_days: int = 8
    refresh_interval_minutes: int = 180
    auto_refresh_on_start: bool = True
    demo_mode: bool = False

    discord_bot_token: str | None = None
    discord_user_id: int = 128587681855832064
    alert_cooldown_hours: int = 12

    amadeus_client_id: str | None = None
    amadeus_client_secret: str | None = None
    seats_aero_api_key: str | None = None
    seats_aero_take: int = 250

    transfer_bonus_feeds: list[str] = Field(
        default_factory=lambda: [
            "https://frequentmiler.com/feed/",
            "https://www.doctorofcredit.com/feed/",
        ]
    )

    @field_validator("origin_airport")
    @classmethod
    def uppercase_airport(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator("transfer_bonus_feeds", mode="before")
    @classmethod
    def split_feeds(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, list):
            return value
        return [item.strip() for item in value.split(",") if item.strip()]

    @field_validator("database_path", mode="before")
    @classmethod
    def ensure_db_path(cls, value: str | Path) -> Path:
        return Path(value)

    @property
    def live_cash_enabled(self) -> bool:
        return bool(self.amadeus_client_id and self.amadeus_client_secret)

    @property
    def live_award_enabled(self) -> bool:
        return bool(self.seats_aero_api_key)

    @property
    def live_discord_enabled(self) -> bool:
        return bool(self.discord_bot_token and self.discord_user_id)

    def prepare_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.prepare_dirs()
    return settings
