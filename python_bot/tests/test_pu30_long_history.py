"""pu30_long_history's fast path must reproduce run_portfolio_backtest trade for trade."""
import numpy as np
import pandas as pd
import pytest

from python_bot.engine.backtest.backtest_engine import BacktestConfig, run_portfolio_backtest
from python_bot.scripts.pu30_long_history import forward_returns, random_baseline, same_day_excess, symbol_trades


def _random_walk(seed, n=700):
    rng = np.random.default_rng(seed)
    close = 100 * np.exp(np.cumsum(rng.normal(0, 0.025, n)))
    open_ = np.r_[close[0], close[:-1]] * (1 + rng.normal(0, 0.004, n))
    high = np.maximum(open_, close) * (1 + np.abs(rng.normal(0, 0.01, n)))
    low = np.minimum(open_, close) * (1 - np.abs(rng.normal(0, 0.01, n)))
    return pd.DataFrame({"date": pd.bdate_range("2022-01-03", periods=n), "open": open_, "high": high,
                         "low": low, "close": close, "volume": 1e6, "is_closed": True})


@pytest.mark.parametrize("seed,stop,target,hold", [
    (0, 3.0, 6.0, 20), (1, 3.0, 6.0, 20), (2, 3.0, 6.0, 20),
    (0, 15.0, 30.0, 20),   # holding expiry
    (11, 15.0, 30.0, 60),  # NU70 exits
])
def test_fast_path_matches_portfolio_engine(seed, stop, target, hold):
    df = _random_walk(seed)
    cfg = BacktestConfig(interval="1d", stop_loss_pct=stop, target_pct=target, holding_bars_max=hold,
                         max_positions=1, max_loss_pct=100.0, initial_capital=1e9)
    engine = run_portfolio_backtest({"X": df}, config=cfg).trades
    fast, _, _ = symbol_trades(df, cfg)
    assert len(engine) > 0
    assert [(pd.Timestamp(t.entry_time).date(), pd.Timestamp(t.exit_time).date(), t.exit_reason) for t in engine] == \
           [(df["date"][t["entry"]].date(), df["date"][t["exit"]].date(), t["reason"]) for t in fast]
    np.testing.assert_allclose([t.net_return_pct for t in engine], [t["net"] for t in fast], rtol=0, atol=1e-6)


def test_forward_returns_and_baseline_shapes():
    df = _random_walk(0, n=60)
    cfg = BacktestConfig(interval="1d", commission_pct=0.0, slippage_pct=0.0)
    fwd = forward_returns(df, cfg, 10)
    assert np.isnan(fwd[-9:]).all() and not np.isnan(fwd[:-9]).any()
    assert fwd[0] == pytest.approx((df["close"][9] / df["open"][0] - 1) * 100)
    results = {"X": {"trades": [{}] * 3, "net": np.full(60, 2.0), "fwd": {10: fwd}}}
    means = random_baseline(results, "rule", 50, np.random.default_rng(0))
    assert means.shape == (50,) and np.allclose(means, 2.0)


def test_same_day_excess_removes_market_move():
    dates = pd.bdate_range("2024-01-01", periods=4).to_numpy()
    results = {}
    for k in range(6):  # every symbol returns k % on every day; X0 trades on two days
        results[f"X{k}"] = {"net": np.full(4, float(k)), "dates": dates, "trades": [], "fwd": {}}
    trades = [{"symbol": "X0", "entry": 1}, {"symbol": "X5", "entry": 2}]
    out = same_day_excess(results, trades, "rule")
    # X0: 0 - mean(1..5) = -3 ; X5: 5 - mean(0..4) = 3
    assert out["n"] == 2 and out["days"] == 2
    assert out["mean"] == pytest.approx(0.0) and out["beat_rate"] == pytest.approx(50.0)
