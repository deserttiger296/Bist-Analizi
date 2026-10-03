# -*- coding: utf-8 -*-
"""
RSI PU30 / NU70 Geriye Dönük Analiz ve Test Motoru (Backtest Engine)
===================================================================

Tasarım ve Güvenilirlik İlkeleri:
1. Look-Ahead Bias & Repainting Koruması:
   - Sinyal, yalnızca teyit barının kapandığı anda (knowable_at) bilinebilir kabul edilir.
   - İşlem girişi, en erken knowable_at sonrasındaki İLK İŞLEM YAPILABİLİR MUMUN AÇILIŞINDA (Open) yapılır.
2. İşlem Maliyetleri (Friction):
   - Komisyon (varsayılan: %0.10) ve kayma/slippage (varsayılan: %0.05) her iki yön için ayrı ayrı düşülür.
3. Survivorship Bias Uyarısı:
   - Veri sağlayıcısı (yfinance) yalnızca halihazırda işlem gören hisseleri döndürebilir; kottan çıkan
     şirketler veri tabanında yer almayabilir.
4. Sağlayıcı Limitleri:
   - 1 saatlik intraday geçmiş yfinance üzerinde maksimum 730 gün ile sınırlıdır.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Dict, Any, Optional
import numpy as np
import pandas as pd

from python_bot.engine.data.provider import get_default_provider, ISTANBUL_TZ
from python_bot.engine.signals.rsi_pu30 import (
    PU30Config,
    NU70Config,
    detect_rsi_pu30,
    detect_rsi_nu70,
    DEFAULT_PU30_CONFIG,
    DEFAULT_NU70_CONFIG,
)


@dataclass
class BacktestTrade:
    symbol: str
    signal_type: str  # "PU30" (Long) veya "NU70" (Short/Exit)
    entry_time: str
    entry_price: float
    exit_time: str
    exit_price: float
    exit_reason: str  # "TARGET", "STOP", "HOLDING_EXPIRY"
    holding_bars: int
    gross_return_pct: float
    net_return_pct: float
    pnl_amount: float


@dataclass
class BacktestConfig:
    commission_pct: float = 0.10     # Tek yön komisyon oranı (%) -> alış + satış = %0.20
    slippage_pct: float = 0.05       # Tek yön ortalama kayma payı (%)
    holding_bars_max: int = 20       # Maksimum pozisyon tutma barı
    target_pct: float = 6.0          # Kâr al hedefi (%)
    stop_loss_pct: float = 3.0       # Zarar kes seviyesi (%)


@dataclass
class BacktestSummary:
    total_trades: int
    winning_trades: int
    losing_trades: int
    win_rate_pct: float
    avg_trade_net_return_pct: float
    total_net_return_pct: float
    profit_factor: float
    max_drawdown_pct: float
    trades: List[BacktestTrade] = field(default_factory=list)
    limitations: List[str] = field(default_factory=list)


def run_single_symbol_backtest(
    df: pd.DataFrame,
    symbol: str,
    config: Optional[BacktestConfig] = None,
    pu30_cfg: Optional[PU30Config] = None,
    nu70_cfg: Optional[NU70Config] = None,
) -> List[BacktestTrade]:
    """
    Tek bir hisse için tam walk-forward simülasyonu çalıştırır.
    Look-ahead bias içermez: Her bar t anında sadece 0..t barları sinyal motoruna verilir.
    """
    if config is None:
        config = BacktestConfig()
    if pu30_cfg is None:
        pu30_cfg = DEFAULT_PU30_CONFIG
    if nu70_cfg is None:
        nu70_cfg = DEFAULT_NU70_CONFIG

    n = len(df)
    if n < 35:
        return []

    trades: List[BacktestTrade] = []
    in_position: bool = False
    active_trade_type = ""
    entry_idx = -1
    entry_price_exec = 0.0
    entry_time_str = ""

    friction_total = (config.commission_pct + config.slippage_pct) * 2  # Giriş + çıkış toplam sürtünme (%)

    # Teyit edilmiş son sinyalleri tekrar tekrar işleme almamak için takip kümesi
    processed_confirm_indices = set()

    for t in range(30, n):
        # 1. Pozisyondaysak çıkış kurallarını kontrol et (Önce SL / TP / Süre)
        if in_position:
            bars_held = t - entry_idx
            curr_bar = df.iloc[t]
            curr_high = float(curr_bar["high"])
            curr_low = float(curr_bar["low"])
            curr_close = float(curr_bar["close"])
            bar_time = str(curr_bar["date"])

            exit_price = None
            exit_reason = ""

            if active_trade_type == "PU30":  # Long işlem
                # Hedef kontrolü
                target_price = entry_price_exec * (1.0 + config.target_pct / 100.0)
                stop_price = entry_price_exec * (1.0 - config.stop_loss_pct / 100.0)

                if curr_low <= stop_price:
                    exit_price = stop_price
                    exit_reason = "STOP"
                elif curr_high >= target_price:
                    exit_price = target_price
                    exit_reason = "TARGET"
                elif bars_held >= config.holding_bars_max:
                    exit_price = curr_close
                    exit_reason = "HOLDING_EXPIRY"

            elif active_trade_type == "NU70":  # Short/Hedge işlem
                target_price = entry_price_exec * (1.0 - config.target_pct / 100.0)
                stop_price = entry_price_exec * (1.0 + config.stop_loss_pct / 100.0)

                if curr_high >= stop_price:
                    exit_price = stop_price
                    exit_reason = "STOP"
                elif curr_low <= target_price:
                    exit_price = target_price
                    exit_reason = "TARGET"
                elif bars_held >= config.holding_bars_max:
                    exit_price = curr_close
                    exit_reason = "HOLDING_EXPIRY"

            if exit_price is not None:
                if active_trade_type == "PU30":
                    gross_ret = (exit_price / entry_price_exec - 1.0) * 100.0
                else:
                    gross_ret = (1.0 - exit_price / entry_price_exec) * 100.0

                net_ret = gross_ret - friction_total
                pnl = net_ret * entry_price_exec / 100.0

                trades.append(
                    BacktestTrade(
                        symbol=symbol,
                        signal_type=active_trade_type,
                        entry_time=entry_time_str,
                        entry_price=round(entry_price_exec, 2),
                        exit_time=bar_time,
                        exit_price=round(exit_price, 2),
                        exit_reason=exit_reason,
                        holding_bars=bars_held,
                        gross_return_pct=round(gross_ret, 2),
                        net_return_pct=round(net_ret, 2),
                        pnl_amount=round(pnl, 2),
                    )
                )
                in_position = False
                active_trade_type = ""
                continue

        # 2. Pozisyonda değilsek, [0..t] verisiyle sinyal motorunu çalıştır
        sub_df = df.iloc[: t + 1].copy()
        sig_pu = detect_rsi_pu30(sub_df, cfg=pu30_cfg, ignore_lifetime=False, interval="4h")
        sig_nu = detect_rsi_nu70(sub_df, cfg=nu70_cfg, ignore_lifetime=False, interval="4h")

        sig_to_take = None
        if sig_pu and sig_pu.get("confirm_index") == t and t not in processed_confirm_indices:
            sig_to_take = ("PU30", sig_pu)
            processed_confirm_indices.add(t)
        elif sig_nu and sig_nu.get("confirm_index") == t and t not in processed_confirm_indices:
            sig_to_take = ("NU70", sig_nu)
            processed_confirm_indices.add(t)

        if sig_to_take and (t + 1 < n):
            sig_type, _ = sig_to_take
            # İŞLEM GİRİŞİ: Look-Ahead koruması gereği sinyalin bilindiği andan (t kapanışı)
            # sonraki ilk barın (t+1) AÇILIŞINDA (Open) + slippage ile gerçekleşir.
            next_bar = df.iloc[t + 1]
            next_open = float(next_bar["open"])
            slippage_adj = next_open * (config.slippage_pct / 100.0)

            if sig_type == "PU30":
                entry_price_exec = next_open + slippage_adj
            else:
                entry_price_exec = next_open - slippage_adj

            in_position = True
            active_trade_type = sig_type
            entry_idx = t + 1
            entry_time_str = str(next_bar["date"])

    return trades


def evaluate_backtest_summary(trades: List[BacktestTrade]) -> BacktestSummary:
    """İşlem listesinden genel performans metriklerini hesaplar."""
    limitations = [
        "Veri kaynağı (yfinance) yalnızca halihazırda işlem gören hisseleri içerir; survivorship bias riski taşır.",
        "1 saatlik veriler en fazla 730 gün geçmişe sahiptir; daha uzun test periyotları sınırlıdır.",
        "Geçmiş simülasyon performansı gelecekteki getiri garantisi sağlamaz.",
    ]

    if not trades:
        return BacktestSummary(
            total_trades=0,
            winning_trades=0,
            losing_trades=0,
            win_rate_pct=0.0,
            avg_trade_net_return_pct=0.0,
            total_net_return_pct=0.0,
            profit_factor=0.0,
            max_drawdown_pct=0.0,
            trades=[],
            limitations=limitations,
        )

    wins = [t for t in trades if t.net_return_pct > 0]
    losses = [t for t in trades if t.net_return_pct <= 0]

    win_rate = (len(wins) / len(trades)) * 100.0
    net_returns = [t.net_return_pct for t in trades]
    avg_net_return = float(np.mean(net_returns))
    total_net_return = float(np.sum(net_returns))

    total_gross_profit = sum(t.net_return_pct for t in wins)
    total_gross_loss = abs(sum(t.net_return_pct for t in losses))
    profit_factor = (total_gross_profit / total_gross_loss) if total_gross_loss > 0 else 99.0

    # Drawdown hesabı
    cumulative = np.cumsum(net_returns)
    peak = np.maximum.accumulate(cumulative)
    drawdowns = peak - cumulative
    max_dd = float(np.max(drawdowns)) if len(drawdowns) > 0 else 0.0

    return BacktestSummary(
        total_trades=len(trades),
        winning_trades=len(wins),
        losing_trades=len(losses),
        win_rate_pct=round(win_rate, 2),
        avg_trade_net_return_pct=round(avg_net_return, 2),
        total_net_return_pct=round(total_net_return, 2),
        profit_factor=round(profit_factor, 2),
        max_drawdown_pct=round(max_dd, 2),
        trades=trades,
        limitations=limitations,
    )
