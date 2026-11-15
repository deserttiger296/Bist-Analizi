# -*- coding: utf-8 -*-
import pytest
from python_bot.engine.signals.long_short_matrix import VIOP_SYMBOLS, build_long_short_matrix


def test_viop_symbols_contains_key_bist_assets():
    assert "THYAO" in VIOP_SYMBOLS
    assert "TUPRS" in VIOP_SYMBOLS
    assert "ISCTR" in VIOP_SYMBOLS
    assert "AKBNK" in VIOP_SYMBOLS
    assert len(VIOP_SYMBOLS) >= 30


def test_build_long_short_matrix_structure():
    # Test on a small deterministic mock or real small sample
    res = build_long_short_matrix(symbols=["TUPRS", "ISCTR"], intervals=("1h",), max_workers=2)
    assert res["status"] == "success"
    assert "market_bias" in res
    assert "market_bias_code" in res
    assert "long_active_count" in res
    assert "short_active_count" in res
    assert isinstance(res["longs"], list)
    assert isinstance(res["shorts"], list)
