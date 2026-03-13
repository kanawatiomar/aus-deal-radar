from __future__ import annotations

import json
import sqlite3
from collections.abc import Sequence
from datetime import datetime, timedelta
from pathlib import Path

from app.models import AwardFare, CashFare, TransferBonus


class RadarDatabase:
    def __init__(self, path: Path):
        self.path = path

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def init(self) -> None:
        with self.connect() as con:
            con.executescript(
                """
                CREATE TABLE IF NOT EXISTS cash_quotes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    batch_id TEXT NOT NULL,
                    origin TEXT NOT NULL,
                    destination TEXT NOT NULL,
                    city TEXT NOT NULL,
                    country TEXT NOT NULL,
                    region TEXT NOT NULL,
                    departure_date TEXT NOT NULL,
                    return_date TEXT,
                    price REAL NOT NULL,
                    currency TEXT NOT NULL,
                    direct INTEGER,
                    carriers TEXT,
                    provider TEXT NOT NULL,
                    link TEXT,
                    observed_at TEXT NOT NULL,
                    score REAL NOT NULL,
                    band TEXT NOT NULL,
                    anomaly_pct REAL NOT NULL,
                    baseline REAL,
                    raw_json TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS award_quotes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    batch_id TEXT NOT NULL,
                    origin TEXT NOT NULL,
                    destination TEXT NOT NULL,
                    city TEXT NOT NULL,
                    country TEXT NOT NULL,
                    region TEXT NOT NULL,
                    departure_date TEXT NOT NULL,
                    cabin TEXT NOT NULL,
                    program TEXT NOT NULL,
                    program_display TEXT NOT NULL,
                    banks_json TEXT NOT NULL,
                    points_cost INTEGER NOT NULL,
                    effective_points_cost REAL,
                    direct INTEGER,
                    carriers TEXT,
                    provider TEXT NOT NULL,
                    observed_at TEXT NOT NULL,
                    score REAL NOT NULL,
                    band TEXT NOT NULL,
                    anomaly_pct REAL NOT NULL,
                    baseline_points REAL,
                    cash_reference REAL,
                    cpp REAL,
                    bonus_percent INTEGER NOT NULL,
                    raw_json TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS transfer_bonuses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    batch_id TEXT NOT NULL,
                    bank TEXT NOT NULL,
                    program TEXT NOT NULL,
                    program_display TEXT NOT NULL,
                    bonus_percent INTEGER NOT NULL,
                    headline TEXT NOT NULL,
                    url TEXT NOT NULL,
                    observed_at TEXT NOT NULL,
                    source TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS alerts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    alert_key TEXT NOT NULL UNIQUE,
                    deal_type TEXT NOT NULL,
                    sent_at TEXT NOT NULL,
                    payload_json TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS refresh_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    batch_id TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL,
                    used_live_cash INTEGER NOT NULL,
                    used_live_award INTEGER NOT NULL,
                    cash_count INTEGER NOT NULL,
                    award_count INTEGER NOT NULL,
                    bonus_count INTEGER NOT NULL,
                    sent_alerts INTEGER NOT NULL
                );
                """
            )

    def insert_cash_quotes(self, batch_id: str, quotes: Sequence[CashFare]) -> None:
        with self.connect() as con:
            con.executemany(
                """
                INSERT INTO cash_quotes (
                    batch_id, origin, destination, city, country, region, departure_date,
                    return_date, price, currency, direct, carriers, provider, link,
                    observed_at, score, band, anomaly_pct, baseline, raw_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        batch_id,
                        quote.origin,
                        quote.destination,
                        quote.city,
                        quote.country,
                        quote.region,
                        quote.departure_date.isoformat(),
                        quote.return_date.isoformat() if quote.return_date else None,
                        quote.price,
                        quote.currency,
                        None if quote.direct is None else int(quote.direct),
                        quote.carriers,
                        quote.provider,
                        quote.link,
                        quote.observed_at.isoformat(),
                        quote.score,
                        quote.band,
                        quote.anomaly_pct,
                        quote.baseline,
                        json.dumps(quote.raw),
                    )
                    for quote in quotes
                ],
            )

    def insert_award_quotes(self, batch_id: str, quotes: Sequence[AwardFare]) -> None:
        with self.connect() as con:
            con.executemany(
                """
                INSERT INTO award_quotes (
                    batch_id, origin, destination, city, country, region, departure_date,
                    cabin, program, program_display, banks_json, points_cost,
                    effective_points_cost, direct, carriers, provider, observed_at,
                    score, band, anomaly_pct, baseline_points, cash_reference, cpp,
                    bonus_percent, raw_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        batch_id,
                        quote.origin,
                        quote.destination,
                        quote.city,
                        quote.country,
                        quote.region,
                        quote.departure_date.isoformat(),
                        quote.cabin,
                        quote.program,
                        quote.program_display,
                        json.dumps(quote.banks),
                        quote.points_cost,
                        quote.effective_points_cost,
                        None if quote.direct is None else int(quote.direct),
                        quote.carriers,
                        quote.provider,
                        quote.observed_at.isoformat(),
                        quote.score,
                        quote.band,
                        quote.anomaly_pct,
                        quote.baseline_points,
                        quote.cash_reference,
                        quote.cpp,
                        quote.bonus_percent,
                        json.dumps(quote.raw),
                    )
                    for quote in quotes
                ],
            )

    def replace_transfer_bonuses(self, batch_id: str, bonuses: Sequence[TransferBonus]) -> None:
        with self.connect() as con:
            con.execute("DELETE FROM transfer_bonuses")
            con.executemany(
                """
                INSERT INTO transfer_bonuses (
                    batch_id, bank, program, program_display, bonus_percent,
                    headline, url, observed_at, source
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        batch_id,
                        bonus.bank,
                        bonus.program,
                        bonus.program_display,
                        bonus.bonus_percent,
                        bonus.headline,
                        bonus.url,
                        bonus.observed_at.isoformat(),
                        bonus.source,
                    )
                    for bonus in bonuses
                ],
            )

    def insert_refresh_run(
        self,
        batch_id: str,
        *,
        created_at: datetime,
        used_live_cash: bool,
        used_live_award: bool,
        cash_count: int,
        award_count: int,
        bonus_count: int,
        sent_alerts: int,
    ) -> None:
        with self.connect() as con:
            con.execute(
                """
                INSERT OR REPLACE INTO refresh_runs (
                    batch_id, created_at, used_live_cash, used_live_award,
                    cash_count, award_count, bonus_count, sent_alerts
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    batch_id,
                    created_at.isoformat(),
                    int(used_live_cash),
                    int(used_live_award),
                    cash_count,
                    award_count,
                    bonus_count,
                    sent_alerts,
                ),
            )

    def list_cash_quotes(self, limit: int = 200) -> list[CashFare]:
        with self.connect() as con:
            rows = con.execute(
                """
                SELECT *
                FROM cash_quotes
                WHERE batch_id = (SELECT batch_id FROM cash_quotes ORDER BY observed_at DESC LIMIT 1)
                ORDER BY score DESC, price ASC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [self._cash_from_row(row) for row in rows]

    def list_award_quotes(self, limit: int = 300) -> list[AwardFare]:
        with self.connect() as con:
            rows = con.execute(
                """
                SELECT *
                FROM award_quotes
                WHERE batch_id = (SELECT batch_id FROM award_quotes ORDER BY observed_at DESC LIMIT 1)
                ORDER BY score DESC, cpp DESC, points_cost ASC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [self._award_from_row(row) for row in rows]

    def list_transfer_bonuses(self) -> list[TransferBonus]:
        with self.connect() as con:
            rows = con.execute(
                """
                SELECT *
                FROM transfer_bonuses
                ORDER BY bonus_percent DESC, observed_at DESC
                """
            ).fetchall()
        return [self._bonus_from_row(row) for row in rows]

    def cash_history(self, origin: str, destination: str, limit: int = 30) -> list[float]:
        with self.connect() as con:
            rows = con.execute(
                """
                SELECT price
                FROM cash_quotes
                WHERE origin = ? AND destination = ?
                ORDER BY observed_at DESC
                LIMIT ?
                """,
                (origin, destination, limit),
            ).fetchall()
        return [float(row["price"]) for row in rows]

    def award_history(
        self, origin: str, destination: str, program: str, cabin: str, limit: int = 30
    ) -> list[int]:
        with self.connect() as con:
            rows = con.execute(
                """
                SELECT points_cost
                FROM award_quotes
                WHERE origin = ? AND destination = ? AND program = ? AND cabin = ?
                ORDER BY observed_at DESC
                LIMIT ?
                """,
                (origin, destination, program, cabin, limit),
            ).fetchall()
        return [int(row["points_cost"]) for row in rows]

    def alert_recently_sent(self, alert_key: str, cooldown_hours: int) -> bool:
        cutoff = datetime.utcnow() - timedelta(hours=cooldown_hours)
        with self.connect() as con:
            row = con.execute(
                "SELECT sent_at FROM alerts WHERE alert_key = ?",
                (alert_key,),
            ).fetchone()
        if not row:
            return False
        return datetime.fromisoformat(row["sent_at"]) >= cutoff

    def record_alert(self, alert_key: str, deal_type: str, payload: dict) -> None:
        with self.connect() as con:
            con.execute(
                """
                INSERT OR REPLACE INTO alerts (alert_key, deal_type, sent_at, payload_json)
                VALUES (?, ?, ?, ?)
                """,
                (alert_key, deal_type, datetime.utcnow().isoformat(), json.dumps(payload)),
            )

    def list_alert_statuses(self) -> dict[str, str]:
        with self.connect() as con:
            rows = con.execute(
                "SELECT alert_key, sent_at FROM alerts ORDER BY sent_at DESC"
            ).fetchall()
        return {row["alert_key"]: row["sent_at"] for row in rows}

    def latest_refresh(self) -> sqlite3.Row | None:
        with self.connect() as con:
            return con.execute(
                "SELECT * FROM refresh_runs ORDER BY created_at DESC LIMIT 1"
            ).fetchone()

    def has_data(self) -> bool:
        with self.connect() as con:
            row = con.execute("SELECT COUNT(*) AS total FROM cash_quotes").fetchone()
        return bool(row and row["total"])

    def _cash_from_row(self, row: sqlite3.Row) -> CashFare:
        return CashFare(
            origin=row["origin"],
            destination=row["destination"],
            city=row["city"],
            country=row["country"],
            region=row["region"],
            departure_date=row["departure_date"],
            return_date=row["return_date"],
            price=row["price"],
            currency=row["currency"],
            direct=None if row["direct"] is None else bool(row["direct"]),
            carriers=row["carriers"],
            provider=row["provider"],
            link=row["link"],
            observed_at=row["observed_at"],
            score=row["score"],
            band=row["band"],
            anomaly_pct=row["anomaly_pct"],
            baseline=row["baseline"],
            raw=json.loads(row["raw_json"]),
        )

    def _award_from_row(self, row: sqlite3.Row) -> AwardFare:
        return AwardFare(
            origin=row["origin"],
            destination=row["destination"],
            city=row["city"],
            country=row["country"],
            region=row["region"],
            departure_date=row["departure_date"],
            cabin=row["cabin"],
            program=row["program"],
            program_display=row["program_display"],
            banks=json.loads(row["banks_json"]),
            points_cost=row["points_cost"],
            effective_points_cost=row["effective_points_cost"],
            direct=None if row["direct"] is None else bool(row["direct"]),
            carriers=row["carriers"],
            provider=row["provider"],
            observed_at=row["observed_at"],
            score=row["score"],
            band=row["band"],
            anomaly_pct=row["anomaly_pct"],
            baseline_points=row["baseline_points"],
            cash_reference=row["cash_reference"],
            cpp=row["cpp"],
            bonus_percent=row["bonus_percent"],
            raw=json.loads(row["raw_json"]),
        )

    def _bonus_from_row(self, row: sqlite3.Row) -> TransferBonus:
        return TransferBonus(
            bank=row["bank"],
            program=row["program"],
            program_display=row["program_display"],
            bonus_percent=row["bonus_percent"],
            headline=row["headline"],
            url=row["url"],
            observed_at=row["observed_at"],
            source=row["source"],
        )
