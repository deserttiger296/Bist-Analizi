"""RSI PU30/NU70 and MOSTRSI scan endpoints, shared by the full engine
(main_api.py) and the lightweight Vercel function (api/index.py). Depends only
on numpy/pandas/yfinance -- no ML packages."""
import os

from fastapi import APIRouter, HTTPException

from python_bot.engine.signals.rsi_pu30 import scan_universe_rsi_pu30, get_symbol_chart_data
from python_bot.engine.signals.most_rsi import scan_universe_most_rsi, get_most_rsi_chart_data
from python_bot.engine.universe import BIST100_SYMBOLS

router = APIRouter()

# I/O-bound (yfinance); more workers keep a 100-symbol scan inside serverless time limits.
SCAN_MAX_WORKERS = int(os.environ.get("SCAN_MAX_WORKERS", "12"))


@router.get("/api/scan/rsi-pu30")
def scan_rsi_pu30(interval: str = "4h", signal_type: str = "all"):
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
        result = scan_universe_rsi_pu30(BIST100_SYMBOLS, max_workers=SCAN_MAX_WORKERS, interval=interval, signal_type=signal_type)
        # Top-level status mirrors the scan's own success/partial/error, so a
        # scan where every symbol failed is never reported as "success".
        return {"status": result["status"], "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/scan/rsi-pu30/{symbol}")
def get_rsi_pu30_symbol_detail(symbol: str, interval: str = "4h"):
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
        return {"status": "success", "data": response_data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/scan/most-rsi")
def scan_most_rsi(interval: str = "1h"):
    """
    MOSTRSI (14, close, VAR 5, 9) Bull/Bear scanner.
    Kıvanç Özbilgiç / Anıl Özekşi TradingView formülü.
    interval: "1h" (varsayılan - TradingView 1s) veya "1d".
    """
    if interval not in ("1d", "1h"):
        raise HTTPException(status_code=400, detail=f"Unsupported interval: {interval}")
    try:
        result = scan_universe_most_rsi(BIST100_SYMBOLS, interval=interval, max_workers=SCAN_MAX_WORKERS)
        return {"status": result["status"], "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/scan/most-rsi/{symbol}")
def get_most_rsi_detail(symbol: str, interval: str = "1h"):
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
        return {"status": "success", "data": result}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
