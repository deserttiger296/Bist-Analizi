"""İzole Çift Yönlü İtki (1-2-3 & %361.8), Fib Zaman ve Walk-Forward (WFO) Laboratuvar API'si.

Klasik /api/scan/rsi-pu30 ve /api/lab uçlarından %100 bağımsızdır.
"""
import re

from fastapi import APIRouter, HTTPException, Response

from python_bot.engine.universe import BIST100_SYMBOLS

router = APIRouter(prefix="/api/impulse-lab", tags=["Impulse & WFO laboratory"])

_VALID_INTERVALS = ("15m", "1h", "4h", "1d")
_VALID_DIRECTIONS = ("all", "bull", "bear", "auto")
_VALID_SCALES = ("linear", "log")


def _validate_symbol(value: str) -> str:
    cleaned = value.strip().upper()
    if not re.fullmatch(r"[A-Z0-9]{2,12}(?:\.IS)?", cleaned):
        raise HTTPException(status_code=400, detail=f"Geçersiz hisse sembolü: {value}")
    return cleaned


def _parse_symbols(raw: str, default_limit: int = 13):
    if not raw or raw.strip().upper() == "ALL":
        return list(BIST100_SYMBOLS)
    selected = list(dict.fromkeys(_validate_symbol(s) for s in raw.split(",") if s.strip()))
    if not selected:
        return list(BIST100_SYMBOLS[:default_limit])
    if len(selected) > 100:
        raise HTTPException(status_code=400, detail="En fazla 100 sembol taranabilir")
    return selected


def _validate_params(interval: str, direction: str, scale: str):
    itv = (interval or "1h").lower()
    if itv not in _VALID_INTERVALS:
        raise HTTPException(status_code=400, detail="Zaman dilimi 15m, 1h, 4h veya 1d olmalı")
    d = (direction or "all").lower()
    if d not in _VALID_DIRECTIONS:
        raise HTTPException(status_code=400, detail="Yön all, bull, bear veya auto olmalı")
    sc = (scale or "linear").lower()
    if sc not in _VALID_SCALES:
        raise HTTPException(status_code=400, detail="Ölçek linear veya log olmalı")
    return itv, d, sc


@router.get("/scan")
def impulse_lab_scan(
    response: Response,
    symbols: str = "VAKBN,ISCTR,GARAN,AKBNK,YKBNK,THYAO,ASELS,TUPRS,PGSUS,SISE,KCHOL,SAHOL,BIMAS",
    interval: str = "1h",
    direction: str = "all",
    scale: str = "linear",
):
    from python_bot.engine.signals.impulse_wfo import scan_bidirectional_impulses

    itv, d, sc = _validate_params(interval, direction, scale)
    sym_list = _parse_symbols(symbols)
    response.headers["Cache-Control"] = "no-store"
    return scan_bidirectional_impulses(symbols=sym_list, interval=itv, direction=d, scale=sc)


@router.get("/wfo")
def impulse_lab_wfo(
    response: Response,
    symbols: str = "VAKBN,ISCTR,GARAN,AKBNK,YKBNK,THYAO,ASELS,TUPRS,PGSUS,SISE,KCHOL,SAHOL,BIMAS",
    interval: str = "1h",
    direction: str = "all",
    scale: str = "linear",
):
    from python_bot.engine.signals.impulse_wfo import run_impulse_wfo

    itv, d, sc = _validate_params(interval, direction, scale)
    sym_list = _parse_symbols(symbols)
    response.headers["Cache-Control"] = "no-store"
    return run_impulse_wfo(symbols=sym_list, intervals=(itv,), direction=d, scale=sc)


@router.get("/chart/{symbol}")
def impulse_lab_chart(
    symbol: str,
    response: Response,
    interval: str = "1h",
    direction: str = "auto",
    scale: str = "linear",
):
    from python_bot.engine.signals.impulse_wfo import get_symbol_impulse_overlay

    sym = _validate_symbol(symbol)
    itv, d, sc = _validate_params(interval, direction, scale)
    response.headers["Cache-Control"] = "no-store"
    return get_symbol_impulse_overlay(symbol=sym, interval=itv, direction=d, scale=sc)
