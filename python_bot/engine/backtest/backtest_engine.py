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
    initial_capital: float = 100000.0
    risk_per_trade_pct: float = 1.0
    max_exposure_pct: float = 100.0
    max_positions: int = 5
    max_loss_pct: float = 10.0
    interval: str = "4h"
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
    equity_curve: List[Dict[str, Any]] = field(default_factory=list)
    exposure_pct: float = 0.0
    average_win_pct: float = 0.0
    average_loss_pct: float = 0.0


def run_portfolio_backtest(frames, config=None, pu30_cfg=None, nu70_cfg=None, signal_filter=None):
    """Spot, long-only, shared cash. Stops first on ambiguous bars; liquidate at data end.

    `signal_filter(symbol, history, signal)` must use only the supplied prefix.
    NU70 is an exit warning, never an implicit short sale.
    """
    from python_bot.engine.data.provider import bar_close_time
    cfg = config or BacktestConfig()
    if not (cfg.initial_capital > 0 and 0 < cfg.stop_loss_pct < 100 and cfg.target_pct > 0
            and 0 < cfg.risk_per_trade_pct <= 100 and 0 < cfg.max_exposure_pct <= 100
            and cfg.max_positions >= 1 and 0 < cfg.max_loss_pct <= 100
            and 0 <= cfg.commission_pct < 100 and 0 <= cfg.slippage_pct < 100):
        raise ValueError("Invalid risk or execution configuration")
    cash = cfg.initial_capital
    positions, pending, marks = {}, {}, {}
    trades, curve = [], [{"time": "initial", "equity": cash, "cash": cash, "unrealized_pnl": 0.0}]
    fee, slip = cfg.commission_pct / 100, cfg.slippage_pct / 100
    timeline = {}
    for symbol, df in frames.items():
        if not df.date.is_monotonic_increasing or df.date.duplicated().any():
            raise ValueError("Bars must be unique and ordered")
        for i, row in df.iterrows():
            if "is_closed" in row and not row.is_closed:
                continue
            ts = pd.Timestamp(row.date)
            ts = ts.tz_localize(ISTANBUL_TZ) if ts.tzinfo is None else ts.tz_convert(ISTANBUL_TZ)
            timeline.setdefault(ts, []).append((symbol, df.index.get_loc(i), row))
    occupied = 0
    for ts, bars in sorted(timeline.items()):
        # Update opening marks before allocations; no future close used for sizing.
        for symbol, i, row in bars:
            marks[symbol] = float(row.open)
        for symbol, i, row in sorted(bars, key=lambda b: b[0]):
            df = frames[symbol]
            order = pending.get(symbol)
            if order and ts >= order["available"]:
                pending.pop(symbol)
                equity = cash + sum(p["qty"] * marks[s] for s, p in positions.items())
                exposure = sum(p["qty"] * marks[s] for s, p in positions.items())
                if symbol not in positions and len(positions) < cfg.max_positions and equity > cfg.initial_capital * (1-cfg.max_loss_pct/100):
                    price = float(row.open) * (1+slip)
                    budget = min(cash/(1+fee), max(0, equity*cfg.max_exposure_pct/100-exposure), equity*cfg.risk_per_trade_pct/cfg.stop_loss_pct)
                    qty = int(budget / price)
                    if qty:
                        cost = qty * price * (1+fee)
                        cash -= cost
                        positions[symbol] = {"qty": qty, "entry": price, "cost": cost, "time": str(ts), "index": i}
            p = positions.get(symbol)
            if p:
                stop, target = p["entry"]*(1-cfg.stop_loss_pct/100), p["entry"]*(1+cfg.target_pct/100)
                raw_exit, reason = None, None
                if float(row.open) <= stop:
                    raw_exit, reason = float(row.open), "STOP_GAP"
                elif float(row.low) <= stop:
                    raw_exit, reason = stop, "STOP"
                elif float(row.open) >= target:
                    raw_exit, reason = float(row.open), "TARGET_GAP"
                elif float(row.high) >= target:
                    raw_exit, reason = target, "TARGET"
                elif p.get("exit_pending"):
                    raw_exit, reason = float(row.open), "NU70_EXIT"
                elif i-p["index"] >= cfg.holding_bars_max:
                    raw_exit, reason = float(row.close), "HOLDING_EXPIRY"
                if i == len(df)-1 and raw_exit is None:
                    raw_exit, reason = float(row.close), "END_OF_DATA"
                if raw_exit is not None:
                    price = raw_exit*(1-slip)
                    proceeds = p["qty"]*price*(1-fee)
                    pnl = proceeds-p["cost"]
                    cash += proceeds
                    trades.append(BacktestTrade(symbol, "PU30", p["time"], p["entry"], str(ts), price, reason, i-p["index"], (raw_exit/p["entry"]-1)*100, pnl/p["cost"]*100, pnl))
                    del positions[symbol]
            marks[symbol] = float(row.close)
            if i >= 30 and i+1 < len(df):
                prefix = df.iloc[:i+1]
                if symbol in positions:
                    sell = detect_rsi_nu70(prefix, cfg=nu70_cfg or DEFAULT_NU70_CONFIG, interval=cfg.interval)
                    if sell and sell["confirm_index"] == i:
                        positions[symbol]["exit_pending"] = True
                elif symbol not in pending:
                    sig = detect_rsi_pu30(prefix, cfg=pu30_cfg or DEFAULT_PU30_CONFIG, interval=cfg.interval)
                    if sig and sig["confirm_index"] == i and (signal_filter is None or signal_filter(symbol, prefix, sig)):
                        available = pd.Timestamp(sig.get("knowable_at", bar_close_time(row.date, cfg.interval)))
                        if available.tzinfo is None: available = available.tz_localize(ISTANBUL_TZ)
                        pending[symbol] = {"available": available}
        equity = cash+sum(p["qty"]*marks[s] for s,p in positions.items())
        occupied += bool(positions)
        curve.append({"time": str(ts), "equity": equity, "cash": cash, "unrealized_pnl": sum(p["qty"]*marks[s]-p["cost"] for s,p in positions.items())})
    summary = evaluate_backtest_summary(trades)
    summary.equity_curve = curve
    eq = np.array([p["equity"] for p in curve], dtype=np.float64)
    summary.total_net_return_pct = float((eq[-1]/cfg.initial_capital-1)*100)
    summary.max_drawdown_pct = float(np.max((1-eq/np.maximum.accumulate(eq))*100))
    summary.exposure_pct = occupied/max(1,len(timeline))*100
    return summary


def run_single_symbol_backtest(df, symbol, config=None, pu30_cfg=None, nu70_cfg=None):
    if len(df) < 35: return []
    return run_portfolio_backtest({symbol: df.reset_index(drop=True)}, config, pu30_cfg, nu70_cfg).trades


def evaluate_backtest_summary(trades):
    returns = np.array([t.net_return_pct for t in trades], dtype=np.float64)
    wins, losses = returns[returns>0], returns[returns<0]
    equity = np.r_[1.0, np.cumprod(1+returns/100)]
    return BacktestSummary(
        total_trades=len(trades), winning_trades=len(wins), losing_trades=len(losses),
        win_rate_pct=len(wins)/max(1,len(trades))*100,
        avg_trade_net_return_pct=float(returns.mean()) if len(returns) else 0.0,
        total_net_return_pct=float((equity[-1]-1)*100),
        profit_factor=float(wins.sum()/-losses.sum()) if len(losses) else None,
        max_drawdown_pct=float(np.max((1-equity/np.maximum.accumulate(equity))*100)),
        trades=trades, average_win_pct=float(wins.mean()) if len(wins) else 0.0,
        average_loss_pct=float(losses.mean()) if len(losses) else 0.0,
        limitations=["Trade-only summary compounds sequential full-capital trades; use portfolio simulation for actual shared capital.",
                      "Spot long-only; NU70 exits, no VIOP, borrowing or leverage.",
                      "Stop-first intrabar assumption; auction liquidity, halts, delistings and corporate-action point-in-time data unverified.",
                      "Open positions liquidated at final close with costs; drawdown sampled at closes, not tick-level."])
