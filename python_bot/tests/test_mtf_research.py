"""Research harness guards: no look-ahead, exact rule mirror, honest event counting."""
import numpy as np
import pandas as pd
import pytest

from python_bot.research import mtf_backtest as bt
from python_bot.research import mtf_learn as learn


def _synthetic(seed=3, sessions=150):
    rng = np.random.default_rng(seed)
    days = pd.bdate_range("2025-01-02", periods=sessions)
    stamps = [pd.Timestamp(d) + pd.Timedelta(hours=9, minutes=30) + pd.Timedelta(hours=h)
              for d in days for h in range(9)]
    dates = pd.DatetimeIndex(stamps).tz_localize("Europe/Istanbul")
    close = 20 * np.exp(np.cumsum(rng.normal(0, 0.012, len(dates))))
    open_ = np.r_[close[0], close[:-1]]
    h1 = pd.DataFrame({"date": dates, "open": open_, "high": np.maximum(open_, close) * 1.004,
                       "low": np.minimum(open_, close) * 0.996, "close": close,
                       "volume": rng.integers(1000, 5000, len(dates)), "is_closed": True})
    day = h1.date.dt.tz_localize(None).dt.normalize()
    d1 = h1.groupby(day).agg(open=("open", "first"), high=("high", "max"), low=("low", "min"),
                             close=("close", "last"), volume=("volume", "sum")).reset_index(names="date")
    d1["is_closed"] = True
    return h1, d1


@pytest.fixture
def market(monkeypatch):
    data = {"SYN": _synthetic()}
    monkeypatch.setattr(bt, "load_symbol", lambda symbol, refresh=False: data[symbol])
    return data


def test_replay_decisions_never_change_when_the_future_changes(market):
    base = bt.replay_symbol("SYN", step=7)
    assert len(base) > 5 and not base.state.eq("REPLAY_ERROR").any()
    cut = base.t.iloc[len(base) // 2]
    h1, d1 = market["SYN"]
    future = h1.date + pd.Timedelta(hours=1) > cut
    shocked = h1.copy()
    shocked.loc[future, ["open", "high", "low", "close"]] *= 0.5     # crash after the cut
    shocked_days = d1.copy()
    shocked_days.loc[shocked_days.date > cut.tz_localize(None).normalize(), ["open", "high", "low", "close"]] *= 0.5
    market["SYN"] = (shocked, shocked_days)
    after = bt.replay_symbol("SYN", step=7)
    known = base.t <= cut
    decision_cols = [c for c in base.columns if not c.startswith(("fwd_", "mfe_", "mae_", "entry_"))]
    pd.testing.assert_frame_equal(base.loc[known, decision_cols], after.loc[known, decision_cols], check_dtype=False)
    # ... while outcomes that reach past the cut do change.
    assert not base.loc[known, "fwd_10"].equals(after.loc[known, "fwd_10"])


def test_reclassify_mirrors_the_lab_decision_exactly(market):
    replay = bt.replay_symbol("SYN", step=3)
    df = learn.prepare(replay, ["SYN"])
    mirrored = learn.reclassify(df, **learn.CURRENT)
    assert mirrored.eq(df.state).all(), df.loc[~mirrored.eq(df.state), ["block", "state"]]


def test_entries_count_a_held_state_once_and_excess_is_zero_mean_per_block():
    blocks = pd.to_datetime(["2026-01-05 14:30"] * 2 + ["2026-01-05 18:10"] * 2 + ["2026-01-06 14:30"] * 2)
    df = pd.DataFrame({"symbol": ["A", "B"] * 3, "block": blocks})
    states = pd.Series(["FULL_CONFIRMATION", "WAITING_CONFIRMATION"] * 2 + ["FULL_CONFIRMATION"] * 2)
    picked = learn.entries(df, states, "FULL_CONFIRMATION")
    assert list(zip(picked.symbol, picked.block)) == [("A", blocks[0]), ("B", blocks[5])]

    replay = pd.DataFrame({"symbol": ["A", "B", "A", "B"], "state": "WAITING_CONFIRMATION",
                           "t": pd.to_datetime(["2026-01-05 14:30", "2026-01-05 14:30",
                                                "2026-01-05 18:30", "2026-01-05 17:30"]),
                           "daily_status": "INTACT", "lower_nu": False, "lower_broken": None,
                           **{f"fwd_{h}": [0.04, 0.0, -0.02, 0.02] for h in bt.HORIZONS}})
    prepared = learn.prepare(replay, ["A", "B"])
    assert prepared.groupby("block").ex_5.sum().abs().max() < 1e-12
    assert prepared.block.nunique() == 2, "17:30 and 18:30 afternoon ends are one block"
