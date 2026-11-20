# -*- coding: utf-8 -*-
r"""BIST100 (1h / 4h / 1d, Yükseliş + Düşüş, Lineer + Log) Walk-Forward İtki Raporu Üreticisi.

Kullanım:
  .\.venv\Scripts\python.exe scripts/generate_impulse_wfo_report.py
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from python_bot.engine.signals.impulse_wfo import DEFAULT_ROUNDTRIP_COST_PCT, run_impulse_wfo
from python_bot.engine.universe import BIST100_SYMBOLS


def main() -> int:
    intervals = ("1h", "4h", "1d")
    print(f"[WFO] BIST100 ({len(BIST100_SYMBOLS)} hisse) x {intervals} Lineer + Log WFO hesaplanıyor...")
    linear_rep = run_impulse_wfo(
        symbols=BIST100_SYMBOLS,
        intervals=intervals,
        direction="all",
        scale="linear",
        roundtrip_cost_pct=DEFAULT_ROUNDTRIP_COST_PCT,
        max_workers=6,
    )
    log_rep = run_impulse_wfo(
        symbols=BIST100_SYMBOLS,
        intervals=intervals,
        direction="all",
        scale="log",
        roundtrip_cost_pct=DEFAULT_ROUNDTRIP_COST_PCT,
        max_workers=6,
    )

    payload = {
        "status": "success",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "universe": "BIST100",
        "universe_count": len(BIST100_SYMBOLS),
        "intervals": list(intervals),
        "roundtrip_cost_pct": DEFAULT_ROUNDTRIP_COST_PCT,
        "scales": {
            "linear": linear_rep["by_interval"],
            "log": log_rep["by_interval"],
        },
        "error_count": linear_rep.get("error_count", 0),
    }

    out_path = ROOT / "public" / "impulse-wfo-report.json"
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[WFO] Rapor kaydedildi: {out_path}")
    for itv in intervals:
        lin_all = linear_rep["by_interval"][itv]["all"]
        t2 = lin_all["t2_confirm"]
        w1 = lin_all["w1_breakout"]
        print(
            f"  {itv.upper()}: t2_confirm(n={t2['count']}, hit161={t2['hit_161_pct']}%, hit361={t2['hit_361_pct']}%, netEV={t2['net_ev_pct']}%) | "
            f"w1_breakout(n={w1['count']}, hit161={w1['hit_161_pct']}%, hit361={w1['hit_361_pct']}%, netEV={w1['net_ev_pct']}%)"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
