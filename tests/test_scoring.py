from app.services.scoring import score_award, score_cash


def test_score_cash_flags_deep_discount():
    score, anomaly_pct, baseline, band = score_cash(140, [260, 250, 240, 255], 240)
    assert baseline >= 240
    assert anomaly_pct > 0.35
    assert score > 40
    assert band in {"good", "hot", "steal"}


def test_score_award_boosts_bonus_and_cpp():
    score, anomaly_pct, baseline, effective_points, cpp, band = score_award(
        42000,
        [65000, 62000, 67000, 64000],
        60000,
        960,
        20,
        True,
    )
    assert baseline >= 60000
    assert anomaly_pct > 0.1
    assert effective_points < 42000
    assert cpp is not None and cpp > 2.0
    assert score > 55
    assert band in {"good", "hot", "steal"}
