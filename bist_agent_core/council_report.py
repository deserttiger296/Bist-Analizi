#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Konsey isabet raporu: journal/council_log.jsonl'daki kararları, sonradan gerçekleşen
5/10/15 işlem günü getirisiyle eşler ve karar / Semih sinyali bazında özetler.
Çalıştırma: bist_agent_core\\.venv\\Scripts\\python bist_agent_core/council_report.py
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import pandas as pd
import yfinance as yf

LOG = Path(__file__).resolve().parent / "journal" / "council_log.jsonl"
HORIZONS = (5, 10, 15)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def _load() -> list[dict]:
    if not LOG.exists():
        return []
    return [json.loads(x) for x in LOG.read_text(encoding="utf-8").splitlines() if x.strip()]


def _tag(rec: dict) -> str:
    s = rec.get("semih") or ""
    if "NU70" in s:
        return "Semih NU70"
    if "PU30" in s:
        return "Semih PU30"
    return "Semih yok"


def main() -> int:
    recs = _load()
    if not recs:
        print("Kayıt yok: önce agentic_engine.py çalıştırın (her çalıştırma journal/council_log.jsonl'a yazar).")
        return 0
    prices: dict[str, pd.Series] = {}
    stats = defaultdict(lambda: defaultdict(list))
    pending = 0
    for r in recs:
        sym = r["symbol"]
        if sym not in prices:
            h = yf.Ticker(f"{sym}.IS").history(period="1y", interval="1d", auto_adjust=True)
            prices[sym] = h["Close"].tz_localize(None) if not h.empty else pd.Series(dtype=float)
        ser = prices[sym]
        t0 = pd.Timestamp(datetime.fromisoformat(r["ts"]).replace(tzinfo=None)).normalize()
        fut = ser[ser.index > t0]
        resolved = False
        for h in HORIZONS:
            if len(fut) >= h:
                stats[(r["decision"], _tag(r))][h].append(float(fut.iloc[h - 1]) / r["price"] - 1.0)
                resolved = True
        if not resolved:
            pending += 1
    print(f"Toplam kayıt: {len(recs)} | Henüz sonuçlanmayan: {pending}")
    print(f"{'Karar':<30}{'Semih':<12}" + "".join(f"{f'{h}G ort / isabet':<22}" for h in HORIZONS))
    for (dec, tag), by_h in sorted(stats.items()):
        row = f"{dec:<30}{tag:<12}"
        for h in HORIZONS:
            v = by_h.get(h, [])
            row += f"{(f'%{sum(v)/len(v)*100:+.1f} / %{sum(1 for x in v if x>0)/len(v)*100:.0f} (n={len(v)})') if v else '-':<22}"
        print(row)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
