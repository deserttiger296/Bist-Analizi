"""Network-free regressions for retries, cache integrity and history guards."""
from types import SimpleNamespace
from unittest.mock import Mock
from pathlib import Path
import subprocess
import sys
import textwrap

import numpy as np
import pandas as pd
import pytest

from python_bot.engine.data import provider as prov
from python_bot.engine.signals import rsi_pu30 as engine


@pytest.fixture(autouse=True)
def clear_cache():
    with prov._RAW_CACHE_LOCK:
        prov._RAW_CACHE.clear()
    yield
    with prov._RAW_CACHE_LOCK:
        prov._RAW_CACHE.clear()


def raw_bars(n=35):
    return pd.DataFrame(
        {"Open": 100., "High": 102., "Low": 99., "Close": 101., "Volume": 1000.},
        index=pd.date_range("2026-01-01", periods=n, name="Date"),
    )


@pytest.mark.parametrize("first", [TimeoutError("timeout"), RuntimeError("HTTP 429"), pd.DataFrame()])
def test_retry_recovers_and_caches_success(monkeypatch, first):
    raw = raw_bars()
    download = Mock(side_effect=[first, raw])
    sleep = Mock()
    monkeypatch.setattr(prov.yf, "download", download)
    monkeypatch.setattr(prov._time, "sleep", sleep)
    provider = prov.YFinanceDataProvider()
    result = provider._download_raw("THYAO.IS", "1d", "1y")
    pd.testing.assert_frame_equal(result, raw)
    result.iloc[0, 0] = -1
    pd.testing.assert_frame_equal(provider._download_raw("THYAO.IS", "1d", "1y"), raw)
    assert download.call_count == 2
    assert download.call_args.kwargs["timeout"] == 15
    sleep.assert_called_once_with(0.4)


@pytest.mark.parametrize("outcomes,error", [
    ([TimeoutError("first"), TimeoutError("last")], True),
    ([pd.DataFrame(), RuntimeError("last")], True),
    ([TimeoutError("first"), pd.DataFrame()], False),
    ([pd.DataFrame(), pd.DataFrame()], False),
])
def test_exhausted_retry_preserves_error_contract_without_caching(monkeypatch, outcomes, error):
    download = Mock(side_effect=outcomes + [raw_bars()])
    monkeypatch.setattr(prov.yf, "download", download)
    monkeypatch.setattr(prov._time, "sleep", lambda _: None)
    provider = prov.YFinanceDataProvider()
    result = provider.fetch_ohlcv("THYAO", interval="1d")
    assert result.status == prov.DataStatus.ERROR
    if error:
        assert result.error_message == "Veri çekme hatası: last"
    else:
        assert "Hisse kottan çıkmış" in result.error_message
    assert not prov._RAW_CACHE
    assert not provider._download_raw("THYAO.IS", "1d", "1y").empty
    assert download.call_count == 3


@pytest.mark.parametrize("period", [None, "5d"])
@pytest.mark.parametrize("missing", ["absent", "empty"])
def test_15m_batch_caches_only_successful_symbols(monkeypatch, period, missing):
    pieces = {"THYAO.IS": raw_bars()}
    if missing == "empty":
        pieces["GARAN.IS"] = raw_bars() * np.nan
    batch = pd.concat(pieces, axis=1)
    download = Mock(return_value=batch)
    monkeypatch.setattr(prov.yf, "download", download)
    provider = prov.YFinanceDataProvider()
    assert provider.prefetch_ohlcv_batch(["THYAO", "GARAN"], interval="15m", period=period) == 1
    expected_period = period or "60d"
    assert download.call_args.kwargs["interval"] == "15m"
    assert download.call_args.kwargs["period"] == expected_period
    assert {key[1] for key in prov._RAW_CACHE} == {"THYAO.IS"}
    pd.testing.assert_frame_equal(provider._download_raw("THYAO.IS", "15m", expected_period), raw_bars())
    assert download.call_count == 1


@pytest.mark.parametrize("interval", ["1h", "4h", "1d"])
@pytest.mark.parametrize("kind", ["pu30", "nu70"])
@pytest.mark.parametrize("n", [engine.MIN_BARS_REQUIRED - 1, engine.MIN_BARS_REQUIRED])
def test_scanner_gates_cross_confirmation_and_trust(monkeypatch, interval, kind, n):
    primary = pd.DataFrame({"close": np.full(engine.MIN_BARS_REQUIRED + 5, 100.)})
    cross = pd.DataFrame({"close": np.full(n, 100.)})
    calls, trusts = [], []

    def fetch(symbol, interval="4h"):
        df = primary if interval == main_interval else cross
        return df, prov.DataResult(symbol=symbol, interval=interval, df=df, status=prov.DataStatus.FRESH)

    def detect(df, cfg, interval):
        calls.append(interval)
        return {"type": kind.upper()}

    def trust(sig, df, sub, tf):
        trusts.append(sub)
        sig["saatlik_seviye"] = {"price": None, "durum": "veri_yok", "kirildi": False}
        sig["tetiklendi"] = False

    main_interval = interval
    monkeypatch.setattr(engine, "_fetch_adjusted_bars", fetch)
    monkeypatch.setattr(engine, "detect_rsi_" + kind, detect)
    monkeypatch.setattr(engine, "apply_hourly_trust_level", trust)
    result = engine.scan_universe_rsi_pu30(["THYAO"], max_workers=1, interval=interval, signal_type=kind)
    assert result["errors"] == []
    assert len(result["signals"]) == 1
    sig = result["signals"][0]
    if n < engine.MIN_BARS_REQUIRED:
        assert calls == [interval]
        assert sig["confirmed_timeframes"] == [interval]
        assert trusts == [None]
    else:
        assert len(calls) > 1
        assert len(sig["confirmed_timeframes"]) > 1
        assert trusts[0] is cross


@pytest.mark.parametrize("kind", ["pu30", "nu70", "all"])
def test_flexible_scanner_skips_short_history(monkeypatch, kind):
    import rsi_divergence_screener as cli
    df = pd.DataFrame({"close": np.full(engine.MIN_BARS_REQUIRED - 1, 100.)})
    monkeypatch.setattr(cli, "_fetch_adjusted_bars", lambda *a, **k: (df, SimpleNamespace(status=prov.DataStatus.FRESH)))
    pu, nu = Mock(), Mock()
    monkeypatch.setattr(cli, "detect_rsi_pu30", pu)
    monkeypatch.setattr(cli, "detect_rsi_nu70", nu)
    assert cli._flexible(["THYAO"], "4h", kind, 1) == []
    pu.assert_not_called()
    nu.assert_not_called()


@pytest.mark.parametrize("dirty", ["nan", "duplicate"])
def test_agent_checks_minimum_after_cleaning_and_uses_timeout(dirty):
    # This engine has its own isolated environment (ta/tabulate are not in the API venv).
    root = Path(__file__).resolve().parents[2]
    interpreter = root / "bist_agent_core/.venv/Scripts/python.exe"
    if not interpreter.exists():
        interpreter = root / "bist_agent_core/.venv/bin/python"
    if not interpreter.exists():
        interpreter = Path(sys.executable)
    script = textwrap.dedent('''
        import sys
        from types import SimpleNamespace
        from unittest.mock import Mock, patch
        import numpy as np
        import pandas as pd
        from bist_agent_core import agentic_engine as agent
        valid = pd.DataFrame(
            {"Open": 100., "High": 102., "Low": 99., "Close": 101., "Volume": 1000.},
            index=pd.date_range("2026-01-01", periods=30),
        )
        invalid = valid.copy()
        if sys.argv[1] == "nan":
            invalid.iloc[0, 0] = np.nan
        else:
            invalid.index = invalid.index[:-1].append(invalid.index[-2:-1])
        history = Mock(side_effect=[invalid, valid.iloc[::-1]])
        with patch.object(agent.yf, "Ticker", return_value=SimpleNamespace(history=history)), patch.object(agent.time, "sleep"):
            result = agent.fetch_with_retry("THYAO.IS", periods=("1y",), retries=2)
        assert len(result) == 30
        assert result.index.is_unique and result.index.is_monotonic_increasing
        assert history.call_count == 2
        assert all(call.kwargs["timeout"] == 15 for call in history.call_args_list)
    ''')
    result = subprocess.run([str(interpreter), "-c", script, dirty], cwd=root, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
