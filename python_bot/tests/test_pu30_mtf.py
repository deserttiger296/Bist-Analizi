"""BAGFS regressions: open-bar veto, closed resistance and ordered MTF states."""
from copy import deepcopy

import numpy as np
import pandas as pd
import pytest

from python_bot.engine.signals import pu30_mtf as engine
from python_bot.engine.signals import pu30_mtf as mtf
from python_bot.engine.data.provider import DataResult, DataStatus, bar_close_time
from python_bot.engine.signals.pu30_mtf import source_is_delayed


def frame(n=45, freq="4h"):
    return pd.DataFrame({
        "date": pd.date_range("2026-08-01 10:00", periods=n, freq=freq, tz="Europe/Istanbul"),
        "open": 22., "high": 23., "low": 22., "close": 22.,
        "volume": 1000., "is_closed": True})


@pytest.fixture
def bagfs(monkeypatch):
    df = frame()
    df.loc[20, "low"] = 21.12
    df.loc[40, "low"] = 20.90
    rsi = np.full(len(df), 50.)
    rsi[20], rsi[40] = 23.3, 30.7
    monkeypatch.setattr(engine, "wilder_rsi", lambda values, period=14: rsi.copy())
    return df, rsi


@pytest.mark.parametrize("forming", [True, False])
def test_bagfs_lower_low_invalidates_without_new_pivot(bagfs, forming):
    df, _ = bagfs
    assert engine.detect_rsi_pu30(df) is not None
    df.loc[44, ["low", "is_closed"]] = [20.88, not forming]
    assert engine.detect_rsi_pu30(df) is None
    diagnostic = engine.detect_rsi_pu30(df, include_invalidated=True)
    assert diagnostic["invalidated"] and not diagnostic["is_active"]
    assert "SECOND_LOW_BROKEN" in diagnostic["invalidation_reasons"]


@pytest.mark.parametrize("forming", [True, False])
def test_bagfs_rsi_292_invalidates_even_without_price_break(bagfs, forming):
    df, rsi = bagfs
    df.loc[44, "is_closed"] = not forming
    rsi[-1] = 29.2
    assert engine.detect_rsi_pu30(df) is None
    diagnostic = engine.detect_rsi_pu30(df, include_invalidated=True)
    assert diagnostic["invalidation_reasons"] == ["RSI_BELOW_30"]
    rsi[-1], rsi[-2] = 50., 29.2
    assert engine.detect_rsi_pu30(df) is None, "A broken pair must not revive on RSI recovery"


def test_open_resistance_cross_never_activates_and_age_is_explicit(bagfs):
    df, _ = bagfs
    df.loc[44, ["close", "high", "is_closed"]] = [24., 25., False]
    signal = engine.detect_rsi_pu30(df)
    assert not signal["tetiklendi"] and not signal["is_active"]
    assert signal["bars_since_confirm"] == 1  # confirmed at index 42, only 43 closed
    assert signal["bars_since_dip2"] == 3  # 41,42,43; not the same age
    df.loc[44, "is_closed"] = True
    assert engine.detect_rsi_pu30(df)["tetiklendi"]
    df.loc[44, "close"] = 23.
    assert not engine.detect_rsi_pu30(df)["tetiklendi"], "Equality is not a breakout"


def test_forming_right_bar_cannot_confirm_new_pivot(bagfs):
    df, _ = bagfs
    df.loc[42, "is_closed"] = False
    assert engine.detect_rsi_pu30(df) is None


def pair(df, first=20, second=40):
    def point(p):
        return {"index": p, "price": 20.9 if p == second else 21.12,
                "time": engine._epoch_seconds(df.date.iloc[p]),
                "date": df.date.iloc[p].strftime("%Y-%m-%d %H:%M"), "rsi": 33. if p == second else 24.}
    return {"type": "PU30", "dip1": point(first), "dip2": point(second),
            "valid": True, "invalidated": False, "pivot_time": point(second)["time"],
            "knowable_at": bar_close_time(df.date.iloc[second + 2], "4h").isoformat(),
            "guven_tazeleyen_tepe": {"price": 21.34}, "bars_since_confirm": 1}


@pytest.fixture
def machine(monkeypatch):
    frames = {"1h": frame(240, "h"), "4h": frame(60), "1d": frame(60, "D")}
    # Fresh breakout: closes stay under the 21.34 resistance until the last bars.
    frames["1h"].loc[:235, "close"] = 21.2
    frames["4h"].loc[:57, "close"] = 21.2
    signals ={"1h": pair(frames["1h"], 100, 120), "4h": pair(frames["4h"]), "1d": pair(frames["1d"])}
    control = {"prior": True}
    def detect(df, interval="4h", **kwargs):
        if interval == "1h" and len(df) < len(frames["1h"]) and not control["prior"]:
            return None
        return deepcopy(signals[interval])
    monkeypatch.setattr(mtf, "detect_rsi_pu30", detect)
    monkeypatch.setattr(mtf, "detect_rsi_nu70", lambda *args, **kwargs: None)
    monkeypatch.setattr(mtf, "wilder_rsi", lambda values: np.full(len(values), 50.))
    return frames, signals, control


def decide(machine, **statuses):
    frames, _, _ = machine
    return mtf.build_mtf_decision(frames, {tf: statuses.get(tf, "FRESH") for tf in frames})


def test_state_a_hourly_valid_but_session_invalid(machine):
    _, signals, _ = machine
    signals["4h"].update(valid=False, invalidated=True)
    result = decide(machine)
    assert result["state"] == "EARLY_REACTION" and not result["is_active_buy"]
    assert result["macro_fibonacci"]["levels"] == []


def test_state_b_requires_closed_breakout_and_daily_structure_not_hourly_pu(machine):
    result = decide(machine)
    assert result["state"] == "FULL_CONFIRMATION" and result["is_active_buy"]
    assert result["layer_flags"] == {"1G_Saglam": True, "1S_PU": True, "4S_PU": True}
    frames, signals, _ = machine
    # The requested phase-2 matrix does not require a separate hourly PU.
    signals["1h"].update(valid=False, invalidated=True)
    assert decide(machine)["state"] == "FULL_CONFIRMATION"
    for tf in ("1h", "4h"):
        frames[tf]["close"] = 21.34
        frames[tf].loc[len(frames[tf])-1, ["close", "is_closed"]] = [22., False]
    result = decide(machine)
    assert result["state"] == "WAITING_CONFIRMATION" and not result["resistance_broken"]


@pytest.mark.parametrize("missing", ["1h", "4h", "1d"])
def test_missing_or_stale_timeframe_never_confirms(machine, missing):
    assert decide(machine, **{missing: "STALE"})["state"] == "DATA_UNAVAILABLE"
    machine[0][missing] = None
    assert decide(machine)["is_active_buy"] is False


def test_daily_support_break_vetoes_even_otherwise_full_confirmation(machine):
    machine[0]["1d"].loc[59, "low"] = 20.88
    assert decide(machine)["state"] == "DAILY_VETO"


def test_unknown_daily_support_is_not_assumed_intact(machine, monkeypatch):
    frames, _, _ = machine
    monkeypatch.setattr(mtf, "find_confirmed_pivot_lows", lambda *args: [])
    machine[1]["1d"].update(valid=False, invalidated=True)
    assert decide(machine)["state"] == "DATA_UNAVAILABLE"


def test_current_open_price_back_under_resistance_removes_green_state(machine):
    frames, _, _ = machine
    assert decide(machine)["is_active_buy"]
    frames["1h"].loc[239, ["close", "low", "is_closed"]] = [21., 21., False]
    result = decide(machine)
    assert result["resistance_broken"]  # earlier closed breakout still exists
    assert not result["price_above_resistance"]
    assert not result["is_active_buy"]


@pytest.mark.parametrize("interval,accepted", [("1h", True), ("4h", False), ("1d", False)])
def test_hourly_equal_price_second_dip_is_allowed(bagfs, interval, accepted):
    df, _ = bagfs
    df.loc[40, "low"] = df.loc[20, "low"]
    assert (engine.detect_rsi_pu30(df, interval=interval) is not None) == accepted


def test_valid_session_structure_does_not_expire_back_into_reaction(monkeypatch):
    df = frame(60)
    df.loc[20, "low"], df.loc[40, "low"] = 21.12, 20.90
    rsi = np.full(60, 50.)
    rsi[20], rsi[40] = 23.3, 30.7
    monkeypatch.setattr(engine, "wilder_rsi", lambda values, period=14: rsi.copy())
    assert engine.detect_rsi_pu30(df) is None  # stand-alone recent-signal filter
    state = mtf.timeframe_state(df, "4h")
    assert state["valid_pu30"]
    assert state["pu30"]["bars_since_confirm"] > 5


def test_one_hour_open_low_invalidates_session_even_if_four_hour_frame_is_old(machine):
    frames, _, _ = machine
    # Deliberately keep the 4h bars unchanged: the veto must come from 1h.
    frames["1h"].loc[239, ["low", "is_closed"]] = [20.89, False]
    result = decide(machine)
    assert result["layer_flags"]["4S_PU"] is False
    assert "HOURLY_LOW_BROKE_SESSION_LOW" in result["timeframes"]["4h"]["pu30"]["invalidation_reasons"]
    assert not result["is_active_buy"]


def test_hourly_low_before_session_dip_does_not_invalidate_later_pair(machine):
    frames, _, _ = machine
    frames["1h"].loc[5, "low"] = 20.0
    assert decide(machine)["state"] == "FULL_CONFIRMATION"


def test_current_session_rsi_veto_is_explicit(machine):
    frames, signals, _ = machine
    state = mtf.timeframe_state(frames["4h"], "4h")
    state["current_rsi"] = 29.2
    invalid = mtf.invalidate_session_from_hourly(frames["1h"], state)
    assert not invalid["valid_pu30"]
    assert "RSI_BELOW_30" in invalid["pu30"]["invalidation_reasons"]


@pytest.mark.parametrize("broken,aligned,expected", [
    (False, False, "LOWER_TF_NU_PRESSURE"),
    (True, False, "EARLY_REACTION"),
    (False, True, "FULL_CONFIRMATION"),
])
def test_lab_pressure_only_when_lower_trend_unbroken_and_macro_not_aligned(machine, monkeypatch, broken, aligned, expected):
    frames, signals, _ = machine
    frames["15m"] = frame(60)
    if not aligned:
        signals["4h"].update(valid=False, invalidated=True)
    monkeypatch.setattr(mtf, "detect_lower_tf_nu_and_rsi_trend", lambda *args: {
        "nu_pressure": True, "rsi_trend_broken": broken, "timeframes": {}})
    assert decide(machine)["state"] == expected


def test_lower_pressure_does_not_hide_unknown_daily_structure(machine, monkeypatch):
    frames, signals, _ = machine
    frames["15m"] = frame(60)
    signals["1d"].update(valid=False, invalidated=True)
    monkeypatch.setattr(mtf, "find_confirmed_pivot_lows", lambda *args: [])
    monkeypatch.setattr(mtf, "detect_lower_tf_nu_and_rsi_trend", lambda *args: {
        "nu_pressure": True, "rsi_trend_broken": False, "timeframes": {}})
    assert decide(machine)["state"] == "DATA_UNAVAILABLE"


def test_fresh_breakout_reports_first_closed_breakout_time(machine):
    result = decide(machine)
    assert result["state"] == "FULL_CONFIRMATION"
    # First closed 1h bar above resistance (index 236), not the latest bar.
    assert result["breakout_at"] == bar_close_time(machine[0]["1h"].date.iloc[236], "1h").isoformat()


def test_old_breakout_consumes_session_pu_and_exposes_lower_tf_pressure(machine, monkeypatch):
    # ISCTR 2026-10-15: August 4h PU broke resistance on Aug 26; weeks later
    # the 1h NU must not be hidden behind that consumed session alignment.
    frames, _, _ = machine
    frames["1h"]["close"] = 22.
    frames["4h"]["close"] = 22.
    result = decide(machine)
    assert result["state"] != "FULL_CONFIRMATION" and not result["is_active_buy"]
    assert result["layer_flags"]["4S_PU"] is False
    session = result["timeframes"]["4h"]
    assert session["consumed"] and session["bars_since_breakout"] > mtf.SESSION_BREAKOUT_LIFETIME_BARS
    assert result["macro_fibonacci"]["levels"] == []
    frames["15m"] = frame(60)
    monkeypatch.setattr(mtf, "detect_lower_tf_nu_and_rsi_trend", lambda *args: {
        "nu_pressure": True, "rsi_trend_broken": False, "timeframes": {}})
    assert decide(machine)["state"] == "LOWER_TF_NU_PRESSURE"


def test_macro_0382_uses_confirmed_high_before_first_dip():
    df = frame(60)
    df.loc[8, "high"] = 40.
    # A much larger, later high must never become the downwave starting point.
    df.loc[55, "high"] = 90.
    result = mtf.macro_fibonacci(df, pair(df))
    assert result["swing_high"]["price"] == 40.
    assert result["target_0382"] == round(20.90 + (40 - 20.90) * .382, 2)
    assert result["target_0382"] != round(20.90 + (23 - 20.90) * .382, 2)


def test_macro_window_is_last_100_bars_up_to_second_dip():
    df = frame(180)
    df.loc[8, "high"] = 100.  # outside the selected 100 bars
    df.loc[80, "high"] = 40.
    result = mtf.macro_fibonacci(df, pair(df, first=130, second=160))
    assert result["lookback_bars"] == 100
    assert result["swing_high"]["price"] == 40.
    assert [level["level"] for level in result["levels"]][:3] == [.382, .5, .618]


def test_resampling_keeps_latest_forming_bagfs_low(monkeypatch):
    rows = []
    for day in pd.bdate_range("2026-09-15", "2026-10-15", tz="Europe/Istanbul"):
        for hour in range(9, 18):
            rows.append({"date": day + pd.Timedelta(hours=hour, minutes=30),
                         "open": 22., "high": 23., "low": 21.5, "close": 22.,
                         "volume": 1000., "is_closed": True})
    hourly = pd.DataFrame(rows)
    hourly.loc[len(hourly)-1, ["low", "is_closed"]] = [20.88, False]
    calls = []
    def fetch(symbol, interval="4h", **kwargs):
        calls.append(kwargs.get("include_forming_bar"))
        df = hourly if interval == "1h" else frame()
        return df, DataResult(symbol=symbol, interval=interval, df=df, status=DataStatus.FRESH)
    monkeypatch.setattr(engine, "_fetch_adjusted_bars", fetch)
    frames, _ = engine._load_pu30_frames("BAGFS")
    assert all(calls)
    assert frames["4h"].date.iloc[-1].strftime("%Y-%m-%d %H:%M") == "2026-10-15 14:30"
    assert frames["4h"].low.iloc[-1] == 20.88


@pytest.mark.parametrize("last,now,interval,delayed", [
    ("2026-10-14 17:30", "2026-10-15 15:30", "4h", True),
    ("2026-10-15 14:30", "2026-10-15 15:30", "4h", False),
    ("2026-10-16 17:30", "2026-10-18 15:30", "1h", False),
    ("2026-10-14", "2026-10-15 15:30", "1d", False),
    ("2026-10-13", "2026-10-15 15:30", "1d", True),
])
def test_intraday_delay_and_weekend_freshness(last, now, interval, delayed):
    assert source_is_delayed(pd.Timestamp(last, tz="Europe/Istanbul"),
                             pd.Timestamp(now, tz="Europe/Istanbul"), interval) == delayed


def test_lab_endpoint_never_caches(monkeypatch):
    from python_bot import mtf_lab_api
    from fastapi import Response
    monkeypatch.setattr(mtf_lab_api, "scan_universe_mtf_lab", lambda *args, **kwargs: {"status": "success", "rows": []})
    response = Response()
    mtf_lab_api.scan_mtf_lab(response)
    assert response.headers["cache-control"] == "no-store"


def test_lab_api_removes_broken_pair_and_exposes_reason(bagfs, monkeypatch):
    from fastapi.testclient import TestClient
    from api.index import app
    df, rsi = bagfs
    df.loc[44, "low"] = 20.88
    rsi[-1] = 29.2
    def fetch(symbol, interval="4h", **kwargs):
        return df.copy(), DataResult(symbol=symbol, interval=interval, df=df.copy(), status=DataStatus.FRESH)
    monkeypatch.setattr(engine, "_fetch_adjusted_bars", fetch)
    monkeypatch.setattr(engine, "_fetch_lab_15m", lambda symbol: (df.copy(), "FRESH"))
    response = TestClient(app).get("/api/py/api/mtf-lab/BAGFS")
    assert response.status_code == 200, response.text
    decision = response.json()["data"]["decision"]
    invalidation = decision["timeframes"]["4h"]["pu30"]
    assert invalidation["invalidated"]
    assert set(invalidation["invalidation_reasons"]) == {
        "SECOND_LOW_BROKEN", "RSI_BELOW_30", "HOURLY_LOW_BROKE_SESSION_LOW"}
    assert decision["is_active_buy"] is False
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("closed", [True, False])
@pytest.mark.parametrize("d1,current,expected", [(23.3, 33.1, "INTACT"), (23.3, 30., "INTACT"), (23.3, 29.99, "BROKEN"), (35., 35., "BROKEN"), (35., 34., "BROKEN")])
def test_daily_live_new_low_uses_rsi_divergence_before_pivot_confirmation(monkeypatch, closed, d1, current, expected):
    df = frame(45, "D")
    df.loc[20, "low"] = 21.12
    df.loc[44, ["low", "is_closed"]] = [20.88, closed]
    rsi = np.full(len(df), 50.); rsi[20] = d1; rsi[-1] = current
    monkeypatch.setattr(mtf, "wilder_rsi", lambda values: rsi.copy())
    monkeypatch.setattr(mtf, "find_confirmed_pivot_lows", lambda *args: [20])
    monkeypatch.setattr(mtf, "detect_rsi_nu70", lambda *args, **kwargs: None)
    result = mtf.daily_structure(df, {"data_status": "FRESH", "valid_pu30": False, "current_rsi": current})
    assert result["status"] == expected
    assert result["support_broken"] is True
    assert result["d1_rsi"] == d1 and result["support"] == 21.12
    if expected == "INTACT":
        assert result["source"] == "DAILY_FORMING_PU" and result["forming_pu"]
        assert "PU" in result["reason"]
    else:
        assert not result["forming_pu"]


def test_live_daily_pu_unlocks_early_reaction_without_faking_confirmed_daily_pu(machine, monkeypatch):
    frames, signals, _ = machine
    signals["1d"].update(valid=False, invalidated=True)
    signals["4h"].update(valid=False, invalidated=True)
    frames["1d"].loc[20, "low"] = 21.12
    frames["1d"].loc[59, ["low", "is_closed"]] = [20.88, False]
    monkeypatch.setattr(mtf, "find_confirmed_pivot_lows", lambda *args: [20])
    def rsi(values):
        result = np.full(len(values), 50.)
        result[20] = 23.3; result[-1] = 33.1
        return result
    monkeypatch.setattr(mtf, "wilder_rsi", rsi)
    result = decide(machine)
    assert result["state"] == "EARLY_REACTION"
    assert result["daily_structure"]["source"] == "DAILY_FORMING_PU"
    assert result["layer_flags"] == {"1G_Saglam": True, "1S_PU": True, "4S_PU": False}
    assert result["timeframes"]["1d"]["valid_pu30"] is False
    assert not result["is_active_buy"]


def test_forming_daily_pu_does_not_remove_independent_nu70_veto(monkeypatch):
    df = frame(45, "D"); df.loc[20, "low"] = 21.12; df.loc[44, "low"] = 20.88
    rsi = np.full(len(df), 50.); rsi[20] = 23.3; rsi[-1] = 33.1
    monkeypatch.setattr(mtf, "wilder_rsi", lambda values: rsi.copy())
    monkeypatch.setattr(mtf, "find_confirmed_pivot_lows", lambda *args: [20])
    monkeypatch.setattr(mtf, "detect_rsi_nu70", lambda *args, **kwargs: {"type": "NU70"})
    result = mtf.daily_structure(df, {"data_status": "FRESH", "valid_pu30": False, "current_rsi": 33.1})
    assert result["status"] == "BROKEN" and "NU70" in result["reason"]
