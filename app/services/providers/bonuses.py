from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import UTC, datetime

import httpx

from app.catalog import PARTNER_PROGRAMS
from app.config import Settings
from app.models import TransferBonus


class TransferBonusFeedProvider:
    name = "rss-feeds"

    def __init__(self, settings: Settings):
        self.settings = settings

    async def fetch(self) -> list[TransferBonus]:
        bonuses: list[TransferBonus] = []
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            for url in self.settings.transfer_bonus_feeds:
                try:
                    response = await client.get(url)
                    response.raise_for_status()
                except httpx.HTTPError:
                    continue
                bonuses.extend(self._parse_feed(response.text, url))
        deduped: dict[tuple[str, str, int], TransferBonus] = {}
        for bonus in bonuses:
            deduped[(bonus.bank, bonus.program, bonus.bonus_percent)] = bonus
        return sorted(deduped.values(), key=lambda item: (-item.bonus_percent, item.bank))

    def _parse_feed(self, text: str, source_url: str) -> list[TransferBonus]:
        try:
            root = ET.fromstring(text)
        except ET.ParseError:
            return []

        items = root.findall(".//item")[:30]
        rows: list[TransferBonus] = []
        for item in items:
            title = self._text(item, "title")
            description = self._text(item, "description")
            link = self._text(item, "link") or source_url
            haystack = f"{title} {description}".lower()
            if "transfer bonus" not in haystack:
                continue
            bank = self._detect_bank(haystack)
            program = self._detect_program(haystack)
            percent = self._detect_percent(haystack)
            if not bank or not program or percent <= 0:
                continue
            rows.append(
                TransferBonus(
                    bank=bank,
                    program=program,
                    program_display=str(PARTNER_PROGRAMS[program]["name"]),
                    bonus_percent=percent,
                    headline=title or f"{bank} transfer bonus for {program}",
                    url=link,
                    observed_at=datetime.now(UTC),
                    source=source_url,
                )
            )
        return rows

    @staticmethod
    def _text(item: ET.Element, tag: str) -> str:
        child = item.find(tag)
        return "" if child is None or child.text is None else child.text.strip()

    @staticmethod
    def _detect_bank(text: str) -> str | None:
        if "capital one" in text or "venture miles" in text or "venture x" in text:
            return "capital_one"
        if "amex" in text or "membership rewards" in text or "american express" in text:
            return "amex"
        return None

    @staticmethod
    def _detect_percent(text: str) -> int:
        match = re.search(r"(\d{1,2})\s*%", text)
        return int(match.group(1)) if match else 0

    @staticmethod
    def _detect_program(text: str) -> str | None:
        alias_map = {
            "aeroplan": ["aeroplan"],
            "avianca": ["avianca", "lifemiles"],
            "britishairways": ["british airways", "executive club", "avios"],
            "cathay": ["cathay"],
            "delta": ["delta", "skymiles"],
            "emirates": ["emirates", "skywards"],
            "etihad": ["etihad", "guest"],
            "flyingblue": ["flying blue"],
            "hawaiian": ["hawaiian"],
            "iberia": ["iberia"],
            "jetblue": ["jetblue", "trueblue"],
            "qantas": ["qantas"],
            "singapore": ["krisflyer", "singapore"],
            "tap": ["tap", "miles&go", "miles and go"],
            "turkish": ["turkish", "miles&smiles", "miles and smiles"],
            "virginatlantic": ["virgin atlantic", "flying club"],
        }
        for program, aliases in alias_map.items():
            if any(alias in text for alias in aliases):
                return program
        return None
