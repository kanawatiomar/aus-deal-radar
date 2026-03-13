from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from app.catalog import DestinationMeta
from app.models import AwardFare, CashFare, TransferBonus


class CashProvider(Protocol):
    name: str

    async def fetch(self, destinations: Sequence[DestinationMeta]) -> list[CashFare]:
        ...


class AwardProvider(Protocol):
    name: str

    async def fetch(self, destinations: Sequence[DestinationMeta]) -> list[AwardFare]:
        ...


class BonusProvider(Protocol):
    name: str

    async def fetch(self) -> list[TransferBonus]:
        ...
