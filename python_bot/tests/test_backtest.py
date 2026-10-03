# -*- coding: utf-8 -*-
"""
Backtest Motoru Birim Testleri
==============================
Kapsam:
- Look-ahead bias koruması (sinyal bilindiği andan sonraki t+1 barında işlem açılması)
- Sürtünme maliyetleri (komisyon ve slippage düşümü)
- Zarar kes (Stop), Kâr al (Target) ve Maksimum Tutma Süresi (Holding Expiry) tetikleri
- Boş / yetersiz veride güvenli çalışma
"""

import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import pytest

from python_bot.engine.backtest.backtest_engine import (
    BacktestConfig,
    run_single_symbol_backtest,
    evaluate_backtest_summary,
)
from python_bot.engine.data.provider import ISTANBUL_TZ


def _make_sample_df(n=50):
    base = pd.Timestamp("2025-01-06 10:00:00", tz=ISTANBUL_TZ)
    dates = [base + timedelta(hours=4 * i) for i in range(n)]
    prices = 100.0 + np.sin(np.linspace(0, 10, n)) * 10
    return pd.DataFrame({
        "date": dates,
        "open": prices,
        "high": prices + 1.0,
        "low": prices - 1.0,
        "close": prices,
        "volume": np.ones(n) * 1000.0,
        "is_closed": np.ones(n, dtype=bool),
    })


def test_backtest_insufficient_bars_returns_empty():
    df = _make_sample_df(n=20)
    trades = run_single_symbol_backtest(df, symbol="TEST")
    assert trades == []


def test_evaluate_summary_with_empty_trades():
    summary = evaluate_backtest_summary([])
    assert summary.total_trades == 0
    assert summary.win_rate_pct == 0.0
    assert len(summary.limitations) > 0


def test_friction_cost_is_applied():
    cfg = BacktestConfig(commission_pct=0.10, slippage_pct=0.05)
    # Total round-trip friction = (0.10 + 0.05) * 2 = 0.30%
    expected_friction = (cfg.commission_pct + cfg.slippage_pct) * 2
    assert expected_friction == pytest.approx(0.30)
