from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from app.config import Settings
from app.models import LiveAircraftBounds, LiveAircraftPayload, LiveAircraftState


TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"
BASE_URL = "https://opensky-network.org/api/states/all"


@dataclass(frozen=True)
class BoundsPreset:
    preset: str
    label: str
    lamin: float | None = None
    lomin: float | None = None
    lamax: float | None = None
    lomax: float | None = None

    def as_model(self) -> LiveAircraftBounds:
        return LiveAircraftBounds(
            preset=self.preset,
            label=self.label,
            lamin=self.lamin,
            lomin=self.lomin,
            lamax=self.lamax,
            lomax=self.lomax,
        )

    def as_params(self) -> dict[str, float]:
        params: dict[str, float] = {}
        if self.lamin is not None:
            params["lamin"] = self.lamin
        if self.lomin is not None:
            params["lomin"] = self.lomin
        if self.lamax is not None:
            params["lamax"] = self.lamax
        if self.lomax is not None:
            params["lomax"] = self.lomax
        return params


BOUNDS_PRESETS: dict[str, BoundsPreset] = {
    "world": BoundsPreset("world", "Global live traffic"),
    "north_america": BoundsPreset(
        "north_america",
        "North America live traffic",
        lamin=14.0,
        lomin=-170.0,
        lamax=72.0,
        lomax=-52.0,
    ),
    "austin_corridor": BoundsPreset(
        "austin_corridor",
        "Austin corridor live traffic",
        lamin=15.0,
        lomin=-135.0,
        lamax=55.0,
        lomax=-55.0,
    ),
}


@dataclass
class CacheEntry:
    payload: LiveAircraftPayload
    expires_at: datetime


class OpenSkyService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.cache_seconds = max(6, settings.opensky_cache_seconds)
        self.client = httpx.AsyncClient(timeout=20.0, follow_redirects=True)
        self._token: str | None = None
        self._token_expires_at = datetime.now(UTC)
        self._token_lock = asyncio.Lock()
        self._cache: dict[str, CacheEntry] = {}

    async def close(self) -> None:
        await self.client.aclose()

    async def snapshot(
        self,
        preset: str = "world",
        include_on_ground: bool = False,
    ) -> LiveAircraftPayload:
        bounds = BOUNDS_PRESETS.get(preset, BOUNDS_PRESETS["world"])
        cache_key = f"{bounds.preset}:{include_on_ground}"
        now = datetime.now(UTC)
        entry = self._cache.get(cache_key)
        if entry and entry.expires_at > now:
            return entry.payload

        try:
            payload = await self._fetch_snapshot(bounds, include_on_ground=include_on_ground)
        except httpx.HTTPError:
            if entry:
                return entry.payload.model_copy(update={"source": "snapshot"})
            if self.settings.demo_mode:
                return self._demo_payload(bounds)
            raise

        self._cache[cache_key] = CacheEntry(
            payload=payload,
            expires_at=now + timedelta(seconds=self.cache_seconds),
        )
        return payload

    async def _fetch_snapshot(
        self,
        bounds: BoundsPreset,
        include_on_ground: bool,
    ) -> LiveAircraftPayload:
        headers: dict[str, str] = {}
        token = await self._get_access_token()
        if token:
            headers["Authorization"] = f"Bearer {token}"

        response = await self.client.get(BASE_URL, params=bounds.as_params(), headers=headers)
        response.raise_for_status()
        payload = response.json()
        fetched_at = datetime.now(UTC)
        states = payload.get("states") or []
        aircraft = [
            aircraft_state
            for state in states
            if (aircraft_state := self._normalize_state(state)) is not None
        ]
        if not include_on_ground:
            aircraft = [item for item in aircraft if not item.on_ground]

        return LiveAircraftPayload(
            fetched_at=fetched_at,
            source="opensky",
            authenticated=bool(token),
            bounds=bounds.as_model(),
            total_states=len(states),
            airborne_count=sum(1 for item in aircraft if not item.on_ground),
            aircraft=aircraft,
        )

    async def _get_access_token(self) -> str | None:
        if not self.settings.live_opensky_authenticated:
            return None

        now = datetime.now(UTC)
        if self._token and self._token_expires_at > now + timedelta(minutes=2):
            return self._token

        async with self._token_lock:
            now = datetime.now(UTC)
            if self._token and self._token_expires_at > now + timedelta(minutes=2):
                return self._token

            response = await self.client.post(
                TOKEN_URL,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.settings.opensky_client_id,
                    "client_secret": self.settings.opensky_client_secret,
                },
            )
            response.raise_for_status()
            token_payload = response.json()
            expires_in = int(token_payload.get("expires_in", 1800))
            self._token = token_payload["access_token"]
            self._token_expires_at = now + timedelta(seconds=expires_in)
            return self._token

    def _normalize_state(self, state: list[Any]) -> LiveAircraftState | None:
        if len(state) < 17:
            return None

        longitude = state[5]
        latitude = state[6]
        if longitude is None or latitude is None:
            return None

        baro_altitude = state[7]
        geo_altitude = state[13]
        altitude = geo_altitude if geo_altitude is not None else baro_altitude

        return LiveAircraftState(
            icao24=str(state[0]).strip(),
            callsign=str(state[1]).strip() or None if state[1] else None,
            origin_country=str(state[2]).strip(),
            longitude=float(longitude),
            latitude=float(latitude),
            baro_altitude_m=float(baro_altitude) if baro_altitude is not None else None,
            geo_altitude_m=float(geo_altitude) if geo_altitude is not None else None,
            altitude_m=float(altitude) if altitude is not None else None,
            velocity_mps=float(state[9]) if state[9] is not None else None,
            heading_deg=float(state[10]) if state[10] is not None else None,
            vertical_rate_mps=float(state[11]) if state[11] is not None else None,
            on_ground=bool(state[8]),
            last_contact=int(state[4]),
            last_position_update=int(state[3]) if state[3] is not None else None,
            category=int(state[17]) if len(state) > 17 and state[17] is not None else None,
        )

    def _demo_payload(self, bounds: BoundsPreset) -> LiveAircraftPayload:
        now = datetime.now(UTC)
        demo_aircraft = [
            LiveAircraftState(
                icao24="demo01",
                callsign="AUS101",
                origin_country="United States",
                longitude=-97.6699,
                latitude=30.1945,
                baro_altitude_m=10400,
                geo_altitude_m=10480,
                altitude_m=10480,
                velocity_mps=238,
                heading_deg=78,
                vertical_rate_mps=0.4,
                on_ground=False,
                last_contact=int(now.timestamp()),
                last_position_update=int(now.timestamp()),
                category=0,
            ),
            LiveAircraftState(
                icao24="demo02",
                callsign="LHR220",
                origin_country="United Kingdom",
                longitude=-28.1,
                latitude=47.5,
                baro_altitude_m=11300,
                geo_altitude_m=11410,
                altitude_m=11410,
                velocity_mps=251,
                heading_deg=259,
                vertical_rate_mps=-0.1,
                on_ground=False,
                last_contact=int(now.timestamp()),
                last_position_update=int(now.timestamp()),
                category=0,
            ),
        ]
        return LiveAircraftPayload(
            fetched_at=now,
            source="demo",
            authenticated=False,
            bounds=bounds.as_model(),
            total_states=len(demo_aircraft),
            airborne_count=len(demo_aircraft),
            aircraft=demo_aircraft,
        )
