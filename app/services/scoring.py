from __future__ import annotations

from statistics import median


def safe_median(values: list[float], fallback: float) -> float:
    cleaned = [float(value) for value in values if value and value > 0]
    return median(cleaned) if cleaned else fallback


def band_for_score(score: float) -> str:
    if score >= 82:
        return "steal"
    if score >= 68:
        return "hot"
    if score >= 52:
        return "good"
    return "watch"


def score_cash(price: float, history: list[float], fallback_baseline: float) -> tuple[float, float, float, str]:
    baseline = safe_median(history, fallback_baseline)
    anomaly_pct = max(0.0, (baseline - price) / baseline) if baseline else 0.0
    score = min(99.0, round(anomaly_pct * 120 + (8 if price < fallback_baseline else 0), 1))
    return score, anomaly_pct, baseline, band_for_score(score)


def score_award(
    points_cost: int,
    history: list[int],
    fallback_points: int,
    cash_reference: float | None,
    bonus_percent: int,
    direct: bool | None,
) -> tuple[float, float, float, float | None, float | None, str]:
    effective_points = points_cost / (1 + (bonus_percent / 100)) if bonus_percent else float(points_cost)
    baseline = safe_median([float(item) for item in history], float(fallback_points))
    anomaly_pct = max(0.0, (baseline - effective_points) / baseline) if baseline else 0.0
    cpp = round((cash_reference / effective_points) * 100, 2) if cash_reference and effective_points else None
    cpp_boost = 0.0 if cpp is None else max(0.0, (cpp - 1.3) * 22)
    score = anomaly_pct * 105 + cpp_boost + (6 if direct else 0) + min(10, bonus_percent / 5)
    score = min(99.0, round(score, 1))
    return score, anomaly_pct, baseline, effective_points, cpp, band_for_score(score)
