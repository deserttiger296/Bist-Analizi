"""Test Center (/lab) suite for VİOP Pay Vadeli engine, glossary, and plain-Turkish layer."""
from pathlib import Path
import re
import subprocess

from python_bot.engine.signals.long_short_matrix import VIOP_SYMBOLS

ROOT = Path(__file__).resolve().parents[2]


def test_viop_calculator_node_unit_suite():
    """Runs the 11 Node unit tests for src/lib/viop.ts (100x multiplier, margin cap, leverage, rollover)."""
    result = subprocess.run(
        ["node", "--test", "scripts/test_viop_calculator.cjs"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_viop_plain_turkish_e2e_contract_and_ssr_suite():
    """Runs the 9 E2E opaque-box contract & SSR tests across R1-R4."""
    result = subprocess.run(
        ["node", "--test", "scripts/test_e2e_viop_plain_turkish.cjs"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=35,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_viop_symbols_parity_between_python_and_typescript():
    """Ensures BIST_VIOP_SYMBOLS in src/lib/viop.ts matches python_bot VIOP_SYMBOLS (41 tickers)."""
    ts_source = (ROOT / "src/lib/viop.ts").read_text(encoding="utf-8")
    match = re.search(r"BIST_VIOP_SYMBOL(?:_LIST|S)[^=]*=\s*(?:new\s+Set\()?\s*\[([\s\S]*?)\]", ts_source)
    assert match, "BIST_VIOP_SYMBOLS not found in src/lib/viop.ts"
    ts_symbols = set(re.findall(r'"([A-Z0-9]+)"', match.group(1)))
    assert len(VIOP_SYMBOLS) == 41
    assert ts_symbols == set(VIOP_SYMBOLS)


def test_viop_reference_spec_and_rehber_route_exist():
    """Verifies authoritative Takasbank/BIST VİOP reference spec and /viop-rehber page."""
    spec = (ROOT / "docs/viop_reference_spec.md").read_text(encoding="utf-8")
    assert "100" in spec and "Takasbank" in spec and "09:30" in spec and "18:10" in spec
    rehber = (ROOT / "src/app/viop-rehber/page.tsx").read_text(encoding="utf-8")
    assert "<WorkspacePage" in rehber and "<ViopCalculator" in rehber
