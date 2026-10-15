"""Opt-in laboratory endpoints. The classic signal router is unchanged."""
import re

from fastapi import APIRouter, HTTPException, Response

from python_bot.engine.universe import BIST100_SYMBOLS

router = APIRouter(prefix="/api/mtf-lab", tags=["MTF laboratory"])


def scan_universe_mtf_lab(symbols):
    # Loading the classic app must not load or initialize lab calculations.
    from python_bot.engine.signals.pu30_mtf import scan_universe_mtf_lab as run
    return run(symbols)


def get_symbol_mtf_lab_data(symbol):
    from python_bot.engine.signals.pu30_mtf import get_symbol_mtf_lab_data as run
    return run(symbol)


def _symbol(value):
    value = value.strip().upper()
    if not re.fullmatch(r"[A-Z0-9]{2,12}(?:\.IS)?", value):
        raise HTTPException(status_code=400, detail="Geçersiz hisse sembolü")
    return value


@router.get("")
def scan_mtf_lab(response: Response, symbols: str = ""):
    selected = list(dict.fromkeys(_symbol(s) for s in symbols.split(","))) if symbols else BIST100_SYMBOLS
    if len(selected) > 100:
        raise HTTPException(status_code=400, detail="En fazla 100 sembol taranabilir")
    response.headers["Cache-Control"] = "no-store"
    result = scan_universe_mtf_lab(selected)
    return {"status": result["status"], "data": result}


@router.get("/{symbol}")
def detail_mtf_lab(symbol: str, response: Response):
    response.headers["Cache-Control"] = "no-store"
    result = get_symbol_mtf_lab_data(_symbol(symbol))
    return {"status": "success", "data": result}
