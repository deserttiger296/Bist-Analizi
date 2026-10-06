"""
RSI uyumsuzluk tarayıcısı (komut satırı) -- sitedeki motorun kendisini kullanır,
ayrı bir kural kopyası içermez: python_bot/engine/signals/rsi_pu30.py.

  PU30 : 1. dip RSI < 30, 2. dip RSI > 30, 2. dip fiyatı daha düşük (katı, varsayılan)
  NU70 : 1. tepe RSI > 70, 2. tepe RSI < 70, 2. tepe fiyatı daha yüksek
  --esnek : 30/70 şartı aranmayan trend uyumsuzluğunu da listeler. Bunlar
            PU_ESNEK / NU_ESNEK olarak etiketlenir; PU30/NU70 DEĞİLDİR.

Zaman dilimi teyidi (Semih Hoca, 3. bölüm): 1s taramada üst teyit 4s veya günlük,
4s/günlük taramada alt teyit 1s. Yalnız 1s = tepki (kısa işlem), 1s + 4s/G = ana dönüş.

Kullanım (repo kökünden):
  python rsi_divergence_screener.py                       # BIST100, 4s
  python rsi_divergence_screener.py ASELS VAKBN --interval 1h
  python rsi_divergence_screener.py --interval 1d --type pu30 --esnek
  python rsi_divergence_screener.py THYAO --json
"""
import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from python_bot.engine.data.provider import DataStatus  # noqa: E402
from python_bot.engine.signals.rsi_pu30 import (  # noqa: E402
    NU70Config, PU30Config, _fetch_adjusted_bars, detect_rsi_nu70, detect_rsi_pu30,
    scan_universe_rsi_pu30,
)
from python_bot.engine.universe import BIST100_SYMBOLS  # noqa: E402

CLASS_LABELS = {
    "DOUBLE_BULL": "ANA DÖNÜŞ (çoklu TF teyitli)",
    "SCALP_1H": "TEPKİ (kısa işlem; 4s/G teyidi yok)",
    "MACRO_4H": "ANA DÖNÜŞ (saatlik tetik bekleniyor)",
    "DOUBLE_BEAR": "ANA ZİRVE (çoklu TF teyitli) -- spot: çık, VİOP: short",
    "SCALP_BEAR": "KISA DÜZELTME (4s/G teyidi yok)",
    "MACRO_BEAR": "ZİRVE YORULMASI (saatlik güven kıran dip bekleniyor)",
}


def _class_label(sig):
    label = CLASS_LABELS.get(sig.get("confluence"), "")
    if sig.get("tetiklendi"):
        label = label.replace("saatlik tetik bekleniyor", "saatlik tetik geldi").replace("saatlik güven kıran dip bekleniyor", "saatlik güven kıran dip kırıldı")
    return label


def _level_text(sig, is_pu):
    name = "saatlik güven tazeleyen tepe" if is_pu else "saatlik güven kıran dip"
    lvl = sig.get("saatlik_seviye")
    if lvl is None:  # flexible signals: between-pivot extreme only
        level = sig.get("guven_tazeleyen_tepe" if is_pu else "guven_kiran_dip") or {}
        return f"ara bölge {'tepe' if is_pu else 'dip'} {level.get('price')}"
    if lvl.get("price") is None:
        return f"{name}: {lvl.get('durum')}"
    state = {"kirildi": "aşıldı" if is_pu else "kırıldı", "bekleniyor_kirilim": "bekleniyor"}.get(lvl["durum"], lvl["durum"])
    back = lvl["durum"] == "kirildi" and lvl.get("fiyat_seviyenin") == ("altinda" if is_pu else "ustunde")
    if back:
        state += ", fiyat şu an yeniden " + ("altında" if is_pu else "üstünde")
    return f"{name} {lvl['price']} ({state})"


def _row(sig, kind=None, cls=None):
    is_pu = sig["type"] == "PU30"
    p1, p2 = (sig["dip1"], sig["dip2"]) if is_pu else (sig["tepe1"], sig["tepe2"])
    return {
        "sembol": sig["symbol"],
        "tur": kind or sig["type"],
        "sinif": cls or _class_label(sig),
        "tf_onay": "+".join(sig.get("confirmed_timeframes", [])),
        "p1": f"{p1['price']:.2f} / RSI {p1['rsi']:.1f} ({p1['date']})",
        "p2": f"{p2['price']:.2f} / RSI {p2['rsi']:.1f} ({p2['date']})",
        "bilinebilir": sig["knowable_at"],
        "seviye": _level_text(sig, is_pu),
        "son_kapanis": round(sig.get("last_close", float("nan")), 2),
    }


def _flexible(symbols, interval, signal_type, workers):
    """Trend divergences that are NOT PU30/NU70 (strict pairs are excluded)."""
    pu_soft, nu_soft = PU30Config(strict_threshold=False), NU70Config(strict_threshold=False)

    def one(sym):
        df, res = _fetch_adjusted_bars(sym, interval=interval)
        if df is None or res.status != DataStatus.FRESH:
            return []
        out = []
        checks = []
        if signal_type in ("all", "pu30"):
            checks.append((detect_rsi_pu30, pu_soft, "PU_ESNEK"))
        if signal_type in ("all", "nu70"):
            checks.append((detect_rsi_nu70, nu_soft, "NU_ESNEK"))
        for detect, cfg, kind in checks:
            sig = detect(df, cfg, interval=interval)
            if not sig:
                continue
            a, b = (sig["dip1"]["rsi"], sig["dip2"]["rsi"]) if kind == "PU_ESNEK" else (sig["tepe1"]["rsi"], sig["tepe2"]["rsi"])
            strict = (a < 30 < b) if kind == "PU_ESNEK" else (a > 70 > b)
            if strict:
                continue  # already reported as PU30/NU70
            sig["symbol"] = sym
            sig["last_close"] = float(df["close"].iloc[-1])
            sig["confirmed_timeframes"] = [interval]
            out.append(_row(sig, kind=kind, cls="ESNEK UYUMSUZLUK -- PU30/NU70 değildir"))
        return out

    with ThreadPoolExecutor(max_workers=workers) as pool:
        return [r for rows in pool.map(one, symbols) for r in rows]


def main(argv=None):
    ap = argparse.ArgumentParser(description="BIST RSI PU30 / NU70 uyumsuzluk tarayıcısı")
    ap.add_argument("semboller", nargs="*", help="Boşsa BIST100")
    ap.add_argument("--interval", choices=["1h", "4h", "1d"], default="4h")
    ap.add_argument("--type", choices=["all", "pu30", "nu70"], default="all")
    ap.add_argument("--esnek", action="store_true", help="Esnek trend uyumsuzluklarını da ayrı etiketle listele")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    symbols = [s.upper() for s in args.semboller] or BIST100_SYMBOLS
    result = scan_universe_rsi_pu30(symbols, max_workers=args.workers, interval=args.interval, signal_type=args.type)
    rows = [_row(s) for s in result["signals"]]
    if args.esnek:
        rows += _flexible(symbols, args.interval, args.type, args.workers)

    report = {
        "status": result["status"], "interval": args.interval, "attempted": result["attempted"],
        "scanned": result["scanned"], "matched": len(rows), "calculated_at": result["calculated_at"],
        "errors": result["errors"], "signals": rows,
    }
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
        return report

    print(f"[{args.interval}] durum={report['status']} taranan={report['scanned']}/{report['attempted']} sinyal={len(rows)}")
    for r in rows:
        print(f"\n{r['sembol']:<7} {r['tur']:<9} {r['sinif']}")
        print(f"  1. {r['p1']}\n  2. {r['p2']}")
        print(f"  TF: {r['tf_onay']} | {r['seviye']} | son kapanış {r['son_kapanis']} | bilinebilir: {r['bilinebilir']}")
    if report["errors"]:
        print("\nTaranamayan: " + ", ".join(f"{e['symbol']} ({e['error'][:40]})" for e in report["errors"]))
    return report


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
