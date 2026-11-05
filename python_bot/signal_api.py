"""RSI PU30/NU70 and MOSTRSI scan endpoints, shared by the full engine
(main_api.py) and the lightweight Vercel function (api/index.py). Depends only
on numpy/pandas/yfinance -- no ML packages."""
import os
import threading

from fastapi import APIRouter, HTTPException, Response

from python_bot.engine.signals.rsi_pu30 import scan_universe_rsi_pu30, get_symbol_chart_data
from python_bot.engine.signals.most_rsi import scan_universe_most_rsi, get_most_rsi_chart_data
from python_bot.engine.universe import BIST100_SYMBOLS

router = APIRouter()

# I/O-bound (yfinance); more workers keep a 100-symbol scan inside serverless time limits.
SCAN_MAX_WORKERS = int(os.environ.get("SCAN_MAX_WORKERS", "12"))

# CDN cache (Vercel honours s-maxage on function responses): one 100-symbol scan serves
# every visitor for 10 minutes instead of each visitor starting a new scan. Payloads carry
# their own calculated_at, so a cached result is never presented as freshly computed.
SCAN_CACHE = "public, s-maxage=600, stale-while-revalidate=1800"
DETAIL_CACHE = "public, s-maxage=300, stale-while-revalidate=900"

_INFLIGHT_SCANS_LOCK = threading.Lock()
_INFLIGHT_SCANS: dict = {}


def _run_coalesced(key: tuple, fn):
    """Single-flight deduplication: concurrent callers for the same scan key
    share one in-flight scan execution instead of multiplying Yahoo Finance load."""
    with _INFLIGHT_SCANS_LOCK:
        entry = _INFLIGHT_SCANS.get(key)
        if entry is None:
            entry = {"event": threading.Event(), "result": None, "error": None}
            _INFLIGHT_SCANS[key] = entry
            is_leader = True
        else:
            is_leader = False

    if not is_leader:
        entry["event"].wait()
        if entry["error"] is not None:
            raise entry["error"]
        return entry["result"]

    try:
        res = fn()
        entry["result"] = res
        return res
    except Exception as exc:
        entry["error"] = exc
        raise
    finally:
        with _INFLIGHT_SCANS_LOCK:
            _INFLIGHT_SCANS.pop(key, None)
        entry["event"].set()


def _cache(response: Response, value: str, status: str) -> None:
    if status in ("success", "partial"):
        response.headers["Cache-Control"] = value


@router.get("/api/scan/rsi-pu30")
def scan_rsi_pu30(response: Response, interval: str = "4h", signal_type: str = "all"):
    """
    RSI PU30 (Dip/Alış) ve NU70 (Tepe/Satış) uyumsuzluk tarayıcısı.
    Semih Murat Ersoy formülü.
    interval: "1d", "4h" veya "1h".
    signal_type: "all", "pu30", "nu70".
    """
    if interval not in ("1d", "4h", "1h"):
        raise HTTPException(status_code=400, detail=f"Unsupported interval: {interval}")
    if signal_type not in ("all", "pu30", "nu70"):
        raise HTTPException(status_code=400, detail=f"Unsupported signal_type: {signal_type}")
    try:
        result = _run_coalesced(
            ("rsi_pu30", interval, signal_type, tuple(BIST100_SYMBOLS)),
            lambda: scan_universe_rsi_pu30(
                BIST100_SYMBOLS, max_workers=SCAN_MAX_WORKERS, interval=interval, signal_type=signal_type
            ),
        )
        if len(BIST100_SYMBOLS) > 1 and result.get("signals"):
            try:
                from python_bot.engine.journal.daily_history import log_pu30_signals
                log_pu30_signals(result["signals"], interval=interval)
            except Exception:
                pass
        # Top-level status mirrors the scan's own success/partial/error, so a
        # scan where every symbol failed is never reported as "success".
        _cache(response, SCAN_CACHE, result["status"])
        return {"status": result["status"], "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/scan/rsi-pu30/{symbol}")
def get_rsi_pu30_symbol_detail(response: Response, symbol: str, interval: str = "4h"):
    """Full price+RSI series and PU30 / NU70 divergence pairs. interval: '1d', '4h', or '1h'.

    Response includes:
      data_status       — FRESH | STALE | INSUFFICIENT_HISTORY | ERROR
      data_updated_at   — ISO timestamp of last successful fetch
      history_limit_note — human-readable provider limit description
    """
    if interval not in ("1d", "4h", "1h"):
        raise HTTPException(status_code=400, detail=f"Unsupported interval: {interval}")
    try:
        result = get_symbol_chart_data(symbol.upper(), interval=interval)
        if result is None:
            raise HTTPException(status_code=404, detail=f"No data for {symbol}")
        # Ensure data quality fields are always present at top level
        response_data = dict(result)
        response_data.setdefault("data_status", "UNKNOWN")
        response_data.setdefault("data_updated_at", None)
        response_data.setdefault("history_limit_note", "")
        _cache(response, DETAIL_CACHE, "success")
        return {"status": "success", "data": response_data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/scan/most-rsi")
def scan_most_rsi(response: Response, interval: str = "1h"):
    """
    MOSTRSI (14, close, VAR 5, 9) Bull/Bear scanner.
    Kıvanç Özbilgiç / Anıl Özekşi TradingView formülü.
    interval: "1h" (varsayılan - TradingView 1s) veya "1d".
    """
    if interval not in ("1d", "1h"):
        raise HTTPException(status_code=400, detail=f"Unsupported interval: {interval}")
    try:
        result = _run_coalesced(
            ("most_rsi", interval, tuple(BIST100_SYMBOLS)),
            lambda: scan_universe_most_rsi(BIST100_SYMBOLS, interval=interval, max_workers=SCAN_MAX_WORKERS),
        )
        _cache(response, SCAN_CACHE, result["status"])
        return {"status": result["status"], "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/scan/most-rsi/{symbol}")
def get_most_rsi_detail(response: Response, symbol: str, interval: str = "1h"):
    """
    Tek bir sembol için tam mum ve MOSTRSI (ExMOV, MOST stop seviyeleri) serisi.
    interval: "1h" veya "1d".
    """
    if interval not in ("1d", "1h"):
        raise HTTPException(status_code=400, detail=f"Unsupported interval: {interval}")
    try:
        result = get_most_rsi_chart_data(symbol.upper(), interval=interval)
        if result is None:
            raise HTTPException(status_code=404, detail=f"No data for {symbol}")
        _cache(response, DETAIL_CACHE, "success")
        return {"status": "success", "data": result}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/lab")
def run_lab_suite(
    mode: str = "impulse",
    symbols: str = "VAKBN,ISCTR,GARAN,AKBNK,YKBNK,THYAO,ASELS,TUPRS",
    interval: str = "1h",
    suite: str = "pu30",
):
    """
    Birleşik Araştırma ve Test Laboratuvarı (Lab) API'si:
      - mode="impulse": PU30 sonrası 1-2 İtki Dalgası anatomisi + Fib Zaman projeksiyonu testbed'i
      - mode="pytest":  Birim ve regresyon test paketini (pytest) çalıştırır ve sonuçları döner
      - mode="journal": Canlı PU30/NU70 sinyal günlüğü (pu30_signal_log.csv) kayıtlarını döner
    """
    import dataclasses
    import subprocess
    import sys
    from pathlib import Path
    from python_bot.engine.data.provider import DataStatus, get_default_provider
    from python_bot.engine.signals.rsi_pu30 import (
        DEFAULT_PU30_CONFIG,
        SCAN_LIFETIME_BARS,
        SCAN_MIN_GAP_BARS,
        apply_hourly_trust_level,
        detect_rsi_pu30,
    )
    from python_bot.scripts.testbed_impulse_fib_time import analyze_impulse_and_fib_time

    if mode == "impulse":
        sym_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
        provider = get_default_provider()
        if len(sym_list) > 1 and hasattr(provider, "prefetch_ohlcv_batch"):
            try:
                provider.prefetch_ohlcv_batch(sym_list, interval=interval)
            except Exception:
                pass

        cfg = dataclasses.replace(
            DEFAULT_PU30_CONFIG,
            signal_lifetime_bars=SCAN_LIFETIME_BARS.get(interval, 36),
            min_gap_bars=SCAN_MIN_GAP_BARS.get(interval, 8),
        )
        items = []
        for sym in sym_list:
            res = provider.fetch_ohlcv(sym, interval=interval, include_forming_bar=False)
            if res.status != DataStatus.FRESH or res.df is None:
                items.append({"symbol": sym, "interval": interval, "has_signal": False, "status": str(res.status.value)})
                continue
            sig = detect_rsi_pu30(res.df, cfg, ignore_lifetime=True, interval=interval)
            if not sig:
                items.append({
                    "symbol": sym,
                    "interval": interval,
                    "has_signal": False,
                    "last_close": round(float(res.df["close"].iloc[-1]), 2),
                })
                continue
            h1_df = res.df if interval == "1h" else provider.fetch_ohlcv(sym, interval="1h", include_forming_bar=False).df
            apply_hourly_trust_level(sig, res.df, h1_df, interval)
            lab_report = analyze_impulse_and_fib_time(res.df, sig)
            items.append({
                "symbol": sym,
                "interval": interval,
                "has_signal": True,
                "last_close": round(float(res.df["close"].iloc[-1]), 2),
                "bars_since_confirm": sig["bars_since_confirm"],
                "in_live_window": bool(sig["bars_since_confirm"] <= cfg.signal_lifetime_bars),
                "dip1": sig["dip1"],
                "dip2": sig["dip2"],
                "saatlik_seviye": sig.get("saatlik_seviye"),
                "impulse_analysis": lab_report,
            })
        return {"status": "success", "mode": "impulse", "interval": interval, "items": items}

    if mode == "pytest":
        root_dir = Path(__file__).resolve().parents[1]
        test_targets = (
            [
                "python_bot/tests/test_pu30_strict.py",
                "python_bot/tests/test_hourly_trust_level.py",
                "python_bot/tests/test_most_rsi.py",
                "python_bot/tests/test_provider_session.py",
            ]
            if suite == "pu30"
            else ["python_bot/tests/"]
        )
        existing_targets = [t for t in test_targets if (root_dir / t).exists()]
        if not existing_targets:
            existing_targets = ["python_bot/tests/test_pu30_strict.py"]
        proc = subprocess.run(
            [sys.executable, "-m", "pytest", *existing_targets, "-v", "--tb=short"],
            cwd=str(root_dir),
            capture_output=True,
            text=True,
            timeout=60,
        )
        return {
            "status": "success",
            "mode": "pytest",
            "suite": suite,
            "exit_code": proc.returncode,
            "passed": proc.returncode == 0,
            "output": (proc.stdout or "") + ("\n" + proc.stderr if proc.stderr else ""),
        }

    if mode == "journal":
        import pandas as pd
        root_dir = Path(__file__).resolve().parents[1]
        log_path = root_dir / "python_bot" / "data" / "pu30_signal_log.csv"
        rows = []
        if log_path.exists():
            df_log = pd.read_csv(log_path).fillna("")
            rows = df_log.tail(50).to_dict(orient="records")[::-1]
        return {"status": "success", "mode": "journal", "count": len(rows), "rows": rows}

    raise HTTPException(status_code=400, detail=f"Unsupported mode: {mode}")

