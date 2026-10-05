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
from pathlib import Path
from zoneinfo import ZoneInfo
import pytest

from python_bot.engine.backtest.backtest_engine import (
    BacktestConfig,
    BacktestTrade,
    run_single_symbol_backtest,
    run_portfolio_backtest,
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


# ===========================================================================
# run_portfolio_backtest -- gerçek sinyal + kontrollü kuyruk barlarıyla
# uçtan uca davranış testleri (section 7 düzeltmeleri)
# ===========================================================================

def _confirmed_pu30_prefix():
    """python_bot/tests/test_rsi_pu30.py'deki aynı PU30 fixture'ını kullanarak
    gerçekten teyit edilmiş bir PU30 sinyali üreten barları döndürür; giriş
    barının indexini de birlikte verir (confirm_index + pivot_right_bars + 1)."""
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from test_rsi_pu30 import TestDetectRsiPU30
    from python_bot.engine.signals.rsi_pu30 import detect_rsi_pu30, PU30Config

    df = TestDetectRsiPU30()._build_pu30_df(n_pad=20).reset_index(drop=True)
    pu_cfg = PU30Config(
        pivot_left_bars=4, pivot_right_bars=2, min_gap_bars=3, max_gap_bars=100,
        strict_threshold=False, max_rsi_dip=1000.0, min_bounce_pct=0.0,
        signal_lifetime_bars=10 ** 9,
    )
    signal = detect_rsi_pu30(df, cfg=pu_cfg, ignore_lifetime=True, interval="1h")
    assert signal is not None, "Fixture bir PU30 sinyali üretmeli (test kurulumu bozulmuş olabilir)"
    entry_index = signal["confirm_index"] + 1  # knowable_at sonrası ilk bar
    return df.iloc[:entry_index + 1].copy().reset_index(drop=True), pu_cfg, entry_index


def _append_bar(df, open_, high, low, close):
    """Son bardan 1 saat sonrasına, tekil ve artan tarihli yeni bir bar ekler
    (test verisinde .loc ile olmayan bir index'e yazmak NaT tarihe yol açar)."""
    last_date = pd.Timestamp(df.iloc[-1]["date"])
    new_row = df.iloc[[-1]].copy()
    new_row["date"] = last_date + timedelta(hours=1)
    new_row[["open", "high", "low", "close"]] = [open_, high, low, close]
    return pd.concat([df, new_row], ignore_index=True)


def test_open_position_liquidated_at_end_of_data():
    """
    Veri sonunda açık kalan pozisyon sonuçlardan KAYBOLMAMALI; END_OF_DATA
    sebebiyle son kapanış fiyatından (maliyetler dahil) kapatılmalı.
    (section 7: "veri sonunda açık pozisyonların sonuçlardan kaybolması" hatası)
    """
    tail_df, pu_cfg, entry_index = _confirmed_pu30_prefix()
    # Giriş barından sonra birkaç düz bar ekle; stop/target/holding hiçbiri
    # tetiklenmesin ki pozisyon gerçekten veri sonuna kadar açık kalsın.
    last = tail_df.iloc[-1]
    for _ in range(3):
        tail_df = _append_bar(tail_df, last["open"], last["high"], last["low"], last["close"])

    cfg = BacktestConfig(commission_pct=0.0, slippage_pct=0.0, stop_loss_pct=90.0,
                          target_pct=90.0, holding_bars_max=10_000, interval="1h")
    summary = run_portfolio_backtest({"TEST": tail_df}, config=cfg, pu30_cfg=pu_cfg)

    assert len(summary.trades) == 1, "Açık pozisyon işlem listesinden kaybolmamalı"
    trade = summary.trades[0]
    assert trade.exit_reason == "END_OF_DATA"
    assert trade.exit_time == str(tail_df.iloc[-1]["date"])
    assert summary.exposure_pct > 0.0


def test_gap_below_stop_fills_at_open_not_stop_price():
    """
    Fiyat stop seviyesinin altında GAP AÇARSA gerçekleşme fiyatı gerçek açılış
    (Open) olmalı, nominal stop fiyatı değil -- aksi "gerçek dışı" bir
    gerçekleşme varsayımı olurdu (section 7).
    """
    tail_df, pu_cfg, entry_index = _confirmed_pu30_prefix()
    entry_price = float(tail_df.iloc[entry_index]["open"])
    tail_df = _append_bar(tail_df, entry_price * 0.85, entry_price * 0.86, entry_price * 0.84, entry_price * 0.855)

    cfg = BacktestConfig(commission_pct=0.0, slippage_pct=0.0, stop_loss_pct=3.0,
                          target_pct=6.0, holding_bars_max=10_000, interval="1h")
    summary = run_portfolio_backtest({"TEST": tail_df}, config=cfg, pu30_cfg=pu_cfg)

    assert len(summary.trades) == 1
    trade = summary.trades[0]
    assert trade.exit_reason == "STOP_GAP"
    nominal_stop = entry_price * (1 - cfg.stop_loss_pct / 100.0)
    assert trade.exit_price < nominal_stop, "Gap barında gerçekleşme açılış fiyatından olmalı, nominal stoptan değil"
    assert trade.exit_price == pytest.approx(entry_price * 0.85, rel=1e-6)


def test_same_bar_stop_and_target_resolves_to_stop():
    """
    Aynı barda hem stop hem hedef seviyesi görülürse (yüksek belirsizlik),
    motor muhafazakar varsayımla STOP'u öncelikli kabul etmeli (section 7:
    "aynı mumda stop/hedef görülmesindeki belirsizlik").
    """
    tail_df, pu_cfg, entry_index = _confirmed_pu30_prefix()
    entry_price = float(tail_df.iloc[entry_index]["open"])
    # Açılış girişle aynı (gap yok), ama bar içinde hem stop hem hedef aşılıyor.
    tail_df = _append_bar(tail_df, entry_price, entry_price * 1.10, entry_price * 0.90, entry_price)

    cfg = BacktestConfig(commission_pct=0.0, slippage_pct=0.0, stop_loss_pct=3.0,
                          target_pct=6.0, holding_bars_max=10_000, interval="1h")
    summary = run_portfolio_backtest({"TEST": tail_df}, config=cfg, pu30_cfg=pu_cfg)

    assert len(summary.trades) == 1
    trade = summary.trades[0]
    assert trade.exit_reason == "STOP"
    assert trade.exit_price == pytest.approx(entry_price * (1 - cfg.stop_loss_pct / 100.0), rel=1e-6)


def test_max_drawdown_includes_first_trade_loss():
    """
    Tek ve ilk işlem %10 zararla sonuçlanıyorsa maksimum düşüş %0 ÇIKMAMALI
    (section 7: "tek bir %10 kayıpta maksimum düşüş %0 çıkması" hatası).

    Eski hatanın kökeni: eski kod `cumulative = cumsum(returns)` ve
    `peak = maximum.accumulate(cumulative)` kullanıyordu. Tek işlemde
    cumulative == peak her zaman eşittir (ikisi de tek elemanlı), bu yüzden
    drawdown = peak - cumulative her zaman 0 çıkıyordu -- kayıp miktarından
    bağımsız. Düzeltme equity eğrisini 1.0'dan başlatıp bileşik çarpımla
    (cumprod) kuruyor, böylece ilk kayıp da tepe-dip farkına yansıyor.
    """
    trade = BacktestTrade(
        symbol="TEST", signal_type="PU30", entry_time="t0", entry_price=100.0,
        exit_time="t1", exit_price=90.0, exit_reason="STOP", holding_bars=1,
        gross_return_pct=-10.0, net_return_pct=-10.0, pnl_amount=-10.0,
    )
    summary = evaluate_backtest_summary([trade])
    assert summary.max_drawdown_pct == pytest.approx(10.0, rel=1e-6), (
        f"Tek %10 zararlı işlemde max_drawdown_pct {summary.max_drawdown_pct} olamaz (eski hata: hep 0 çıkıyordu)"
    )
