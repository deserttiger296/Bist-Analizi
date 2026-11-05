"""
Agentic AI Quant Council (Otonom Çoklu-Ajan Karar & İtki Araştırma Masası)
==========================================================================
Ücretsiz (0 maliyetli) 4 uzman ajanın işbirliğiyle BIST hisselerini analiz eder:

1. StructureAgent (PU30 & Saatlik Yapı Avcısı):
   - Semih Hoca'nın PU30/NU70 + kuruş toleransı (%0.25) + dönüş mumu RSI kurallarını denetler.
   - Saatlik Güven Tazeleyen Tepe / Güven Kıran Dip kırılımını kontrol eder.
2. ImpulseAgent (1-2 İtki & Fib Zaman Analisti):
   - PU30 dibinden (t0) kalkan 1 nolu itki dalgasının kalitesini 0-100 arasında puanlar:
     * Yeşil mum oranı, gövde/boy oranı (momentum), hacim çarpanı, RSI ivmesi (+ΔRSI).
   - 2 nolu düzeltme dalgasının Fibo geri çekilmesini (0.382 - 0.618 - 0.786) ve
     Fib Zaman (0.382 / 0.618 / 1.000 / 1.618) projeksiyon pencerelerini çıkarır.
3. CriticAgent (Şeytanın Avukatı & Risk Denetçisi):
   - İşlemin neden başarısız olabileceğini (sahte kırılım, düşük hacimli itki, aşırı derin W2,
     uzak stop mesafesi) denetler ve somut İptal (Stop) seviyesini belirler.
4. SynthesizerAgent (Baş Stratejist & OpenRouter Free LLM Entegrasyonu):
   - 3 ajanın bulgularını birleştirerek nihai aksiyon planını (GÜÇLÜ AL / TEYİT BEKLE / İZLE / VETO)
     üretir. Sistemde geçerli bir ücretsiz OpenRouter anahtarı tanımlıysa (`OPENROUTER_API_KEY` veya
     `~/.claude/settings.json`), ücretsiz model (`deepseek/deepseek-chat-v3-0324:free`) ile ek sentez
     yorumu da ekler; anahtar yoksa %100 yerel deterministik motorla 0 token harcayarak çalışır.
"""
from __future__ import annotations

import dataclasses
import json
import os
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

from python_bot.engine.data.provider import DataStatus, get_default_provider
from python_bot.engine.signals.rsi_pu30 import (
    DEFAULT_PU30_CONFIG,
    SCAN_LIFETIME_BARS,
    SCAN_MIN_GAP_BARS,
    apply_hourly_trust_level,
    detect_rsi_pu30,
)
from python_bot.scripts.testbed_impulse_fib_time import analyze_impulse_and_fib_time


def _score_impulse_quality(w1: Optional[Dict[str, Any]], w2: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """1 nolu itki dalgasının kalitesini 0-100 üzerinden puanlar."""
    if not w1:
        return {"score": 0, "grade": "YOK", "notes": ["1 nolu itki dalgası henüz tamamlanmadı."]}

    score = 0
    notes: List[str] = []

    # 1. Fiyat yüzdesi (max 25p)
    gain = float(w1.get("gain_pct", 0.0))
    if gain >= 4.0:
        score += 25
        notes.append(f"Güçlü 1. dalga fiyat itkisi (+%{gain:.2f})")
    elif gain >= 2.0:
        score += 15
        notes.append(f"Orta ölçekli 1. dalga itkisi (+%{gain:.2f})")
    else:
        score += 5
        notes.append(f"Zayıf/kısa 1. dalga boyu (+%{gain:.2f})")

    # 2. Hacim çarpanı (max 25p)
    vol = float(w1.get("volume_multiplier", 0.0))
    if vol >= 1.3:
        score += 25
        notes.append(f"Kurumsal hacim katılımı var ({vol:.2f}x ort. hacim)")
    elif vol >= 1.0:
        score += 15
        notes.append(f"Normal hacim katılımı ({vol:.2f}x)")
    else:
        score += 5
        notes.append(f"Hacim desteği zayıf ({vol:.2f}x)")

    # 3. Yeşil mum & gövde oranı (max 25p)
    bull_ratio = float(w1.get("bull_bar_ratio", 0.0))
    body_ratio = float(w1.get("avg_body_to_range", 0.0))
    if bull_ratio >= 0.70 and body_ratio >= 0.40:
        score += 25
        notes.append(f"Temiz itki mumları (%{int(bull_ratio*100)} yeşil, gövde/boy {body_ratio:.2f})")
    elif bull_ratio >= 0.50:
        score += 15
        notes.append(f"Karışık/orta mum yapısı (%{int(bull_ratio*100)} yeşil)")
    else:
        score += 5
        notes.append("İğneli/kararsız mum yapısı")

    # 4. RSI ivmesi ve Dalga 2 Fibo geri çekilme kalitesi (max 25p)
    rsi_delta = float(w1.get("rsi_delta", 0.0))
    if rsi_delta >= 12.0:
        score += 15
        notes.append(f"Güçlü RSI momentum patlaması (+{rsi_delta:.1f} puan)")
    elif rsi_delta >= 6.0:
        score += 8

    if w2:
        ret = float(w2.get("price_retracement_fib", 1.0))
        if 0.30 <= ret <= 0.65:
            score += 10
            notes.append(f"İdeal Altın Oran Dalga 2 düzeltmesi (Fibo {ret:.3f})")
        elif ret <= 0.80:
            score += 6
            notes.append(f"Derin ama geçerli Dalga 2 düzeltmesi (Fibo {ret:.3f})")
        else:
            notes.append(f"Çok derin Dalga 2 düzeltmesi (Fibo {ret:.3f} > 0.80 — dikkat)")

    grade = "A+ (Kusursuz İtki)" if score >= 80 else "B (Geçerli İtki)" if score >= 60 else "C (Zayıf Tepki)"
    return {"score": score, "grade": grade, "notes": notes}


def _try_free_openrouter_synthesis(prompt_summary: str) -> Optional[str]:
    """
    Kullanıcıda geçerli bir ücretsiz OpenRouter anahtarı varsa (`OPENROUTER_API_KEY` veya
    `~/.claude/settings.json`), ücretsiz modelden 3 cümlelik yönetici özeti alır.
    Anahtar yoksa veya placeholder ise None döner (0 maliyet, hata fırlatmaz).
    """
    token = os.environ.get("OPENROUTER_API_KEY", "").strip()
    model = "deepseek/deepseek-chat-v3-0324:free"
    if not token:
        try:
            cfg_path = Path.home() / ".claude" / "settings.json"
            if cfg_path.exists():
                data = json.loads(cfg_path.read_text(encoding="utf-8"))
                env_tok = data.get("env", {}).get("ANTHROPIC_AUTH_TOKEN", "").strip()
                if env_tok and "BURAYA_KEY_YAZ" not in env_tok:
                    token = env_tok
                model = data.get("env", {}).get("ANTHROPIC_MODEL", model)
        except Exception:
            pass

    if not token or "BURAYA_KEY_YAZ" in token:
        return None

    try:
        payload = json.dumps({
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": "Sen Semih Murat Ersoy'un PU30, Saatlik Güven Tazeleyen Tepe ve 1-2 İtki Dalgası + Fib Zaman kurallarına göre çalışan baş kuant stratejistisin. En fazla 3 kısa cümleyle Türkçe net işlem planı yaz.",
                },
                {"role": "user", "content": prompt_summary},
            ],
            "max_tokens": 220,
            "temperature": 0.2,
        }).encode("utf-8")
        req = urllib.request.Request(
            "https://openrouter.ai/api/v1/chat/completions",
            data=payload,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return body["choices"][0]["message"]["content"].strip()
    except Exception:
        return None


def run_agentic_council(
    symbol: str,
    interval: str = "1h",
    use_llm: bool = False,
) -> Dict[str, Any]:
    """
    Tek bir BIST hissesi üzerinde 4 otonom ajanı sırasıyla çalıştırır ve
    tartışma + karar matrisini döner.
    """
    provider = get_default_provider()
    res = provider.fetch_ohlcv(symbol, interval=interval, include_forming_bar=False)
    if res.status != DataStatus.FRESH or res.df is None:
        return {
            "symbol": symbol.upper(),
            "interval": interval,
            "status": "no_data",
            "verdict": "VERİ YOK",
            "agents": [],
        }

    df = res.df
    last_close = round(float(df["close"].iloc[-1]), 2)
    cfg = dataclasses.replace(
        DEFAULT_PU30_CONFIG,
        signal_lifetime_bars=SCAN_LIFETIME_BARS.get(interval, 36),
        min_gap_bars=SCAN_MIN_GAP_BARS.get(interval, 8),
    )

    sig = detect_rsi_pu30(df, cfg, ignore_lifetime=True, interval=interval)
    if not sig:
        return {
            "symbol": symbol.upper(),
            "interval": interval,
            "status": "no_pu30",
            "last_close": last_close,
            "verdict": "PU30 YOK — İZLEMEDE KAL",
            "confidence": 15,
            "agents": [
                {
                    "role": "Ajan 1: PU30 & Yapı Avcısı",
                    "badge": "RED",
                    "summary": f"{symbol.upper()} ({interval}) grafiğinde katı PU30 (1. dip RSI < 30, 2. dip RSI > 30) şartı henüz oluşmadı.",
                }
            ],
        }

    # Çapraz zaman dilimi kontrolü (1s <-> 4s)
    cross_tf = "4h" if interval == "1h" else "1h"
    cross_res = provider.fetch_ohlcv(symbol, interval=cross_tf, include_forming_bar=False)
    cross_cfg = dataclasses.replace(
        DEFAULT_PU30_CONFIG,
        signal_lifetime_bars=SCAN_LIFETIME_BARS.get(cross_tf, 10),
        min_gap_bars=SCAN_MIN_GAP_BARS.get(cross_tf, 6),
    )
    has_cross = bool(
        cross_res.status == DataStatus.FRESH
        and cross_res.df is not None
        and detect_rsi_pu30(cross_res.df, cross_cfg, interval=cross_tf)
    )

    h1_df = df if interval == "1h" else (cross_res.df if cross_tf == "1h" else None)
    apply_hourly_trust_level(sig, df, h1_df, interval)
    trust = sig.get("saatlik_seviye") or {}
    impulse = analyze_impulse_and_fib_time(df, sig)
    w1 = impulse.get("dalga1")
    w2 = impulse.get("dalga2")
    w3 = impulse.get("dalga3_takip")
    imp_score = _score_impulse_quality(w1, w2)

    # Ajan 1: Yapı Avcısı
    d1, d2 = sig["dip1"], sig["dip2"]
    mtf_str = f"{interval}+{cross_tf} ÇİFTE ONAY (ANA DÖNÜŞ)" if has_cross else f"Yalnızca {interval} (Tepki Adayı)"
    agent1 = {
        "role": "Ajan 1: PU30 & Saatlik Yapı Avcısı",
        "badge": "ONAY" if trust.get("kirildi") else "BEKLİYOR",
        "summary": (
            f"1. Dip {d1['price']:.2f} ₺ (RSI {d1['rsi']:.1f}) → 2. Dip {d2['price']:.2f} ₺ (RSI {d2['rsi']:.1f}). "
            f"Çoklu TF: {mtf_str}. Saatlik Güven Tazeleyen Tepe: {trust.get('price') or 'Bekleniyor'} ₺ "
            f"(Durum: {trust.get('durum')})."
        ),
        "metrics": {
            "dip1": f"{d1['price']:.2f} ₺ (RSI {d1['rsi']:.1f})",
            "dip2": f"{d2['price']:.2f} ₺ (RSI {d2['rsi']:.1f})",
            "mtf": mtf_str,
            "trust_level": trust.get("price"),
            "trust_broken": bool(trust.get("kirildi")),
        },
    }

    # Ajan 2: İtki & Fib Zaman Analisti
    fib_100 = impulse.get("fib_zaman_02_sundurme", {}).get("1.000", {})
    fib_1618 = impulse.get("fib_zaman_02_sundurme", {}).get("1.618", {})
    agent2 = {
        "role": "Ajan 2: 1-2 İtki & Fib Zaman Analisti",
        "badge": f"SKOR {imp_score['score']}/100 ({imp_score['grade']})",
        "summary": (
            f"1 Nolu İtki: {impulse.get('p0_price')} → {w1['p1_price']} ₺ (+%{w1['gain_pct']}, {w1['duration_bars']} bar, "
            f"Hacim {w1['volume_multiplier']}x). "
            f"2 Nolu Düzeltme: {w2['p2_price']} ₺ (Fibo {w2['price_retracement_fib']}). "
            f"0-2 Sündürme Fib Zaman hedefleri: 1.000 -> {fib_100.get('target_date')}, 1.618 -> {fib_1618.get('target_date')}."
            if (w1 and w2)
            else "1-2 itki kalıbı henüz tamamlanmadı; ilk saatlik yüksek dip (t2) bekleniyor."
        ),
        "notes": imp_score["notes"],
        "impulse": impulse,
    }

    # Ajan 3: Şeytanın Avukatı & Risk Denetçisi
    stop_price = round(float(w2["p2_price"] if w2 else d2["price"]), 2)
    stop_dist_pct = round((last_close / stop_price - 1.0) * 100.0, 2) if stop_price > 0 else 0.0
    risk_warnings: List[str] = []
    if not has_cross:
        risk_warnings.append("Üst zaman dilimi (4s) teyidi yok; düşüş trendinde kısa tepki kalabilir.")
    if not trust.get("kirildi"):
        risk_warnings.append("Saatlik güven tazeleyen tepe henüz kapanışla kırılmadı (erken giriş riski).")
    if w1 and float(w1.get("volume_multiplier", 0.0)) < 1.0:
        risk_warnings.append(f"1. dalgada hacim ortalamanın altında ({w1['volume_multiplier']}x).")
    if w2 and float(w2.get("price_retracement_fib", 0.0)) > 0.80:
        risk_warnings.append(f"2. dalga Fibo {w2['price_retracement_fib']} ile çok derin geri çekildi.")
    if stop_dist_pct > 8.5:
        risk_warnings.append(f"Fiyat giriş/stop seviyesinden %{stop_dist_pct} uzaklaştı; geri çekilme (pullback) beklenmeli.")
    if not risk_warnings:
        risk_warnings.append("Kritik yapısal kusur bulunmadı; stop seviyesi korunarak trend takip edilebilir.")

    agent3 = {
        "role": "Ajan 3: Şeytanın Avukatı & Risk Denetçisi",
        "badge": "DİKKAT" if len(risk_warnings) >= 2 else "TEMİZ RİSK",
        "summary": " | ".join(risk_warnings),
        "stop_price": stop_price,
        "stop_distance_pct": stop_dist_pct,
        "warnings": risk_warnings,
    }

    # Ajan 4: Baş Stratejist Sentezi
    confidence = 40
    if has_cross:
        confidence += 20
    if trust.get("kirildi"):
        confidence += 20
    confidence += int(imp_score["score"] * 0.2)
    confidence = min(98, max(10, confidence))

    if trust.get("kirildi") and has_cross and imp_score["score"] >= 55:
        verdict = "💎 GÜÇLÜ ONAY (ANA DÖNÜŞ & İTKİ TEYİTLİ)"
    elif trust.get("kirildi"):
        verdict = "✅ ALIM TEYİDİ AKTİF (SAATLİK TEPE AŞILDI)"
    elif trust.get("price"):
        verdict = f"⏳ TETİK BEKLENİYOR ({trust['price']} ₺ Üstü Saatlik Kapanış)"
    else:
        verdict = "🔍 ERKEN AŞAMA (2 Nolu Yüksek Dip Yapısı Bekleniyor)"

    target_fibo_1618 = sig["fibonacci_levels"][0]["price"] if sig.get("fibonacci_levels") else None
    synth_text = (
        f"Karar: {verdict}. Giriş/Teyit Seviyesi: {trust.get('price') or 'Oluşuyor'} ₺, "
        f"Yapısal Stop (İptal) Seviyesi: {stop_price} ₺ (mesafe %{stop_dist_pct}), "
        f"Ana Fiyat Hedefi (Fibo 1.618): {target_fibo_1618} ₺."
    )

    llm_comment = _try_free_openrouter_synthesis(f"{symbol}: {agent1['summary']} {agent2['summary']} {agent3['summary']}") if use_llm else None
    agent4 = {
        "role": "Ajan 4: Baş Stratejist (Konsey Kararı)",
        "badge": f"GÜVEN %{confidence}",
        "summary": synth_text,
        "llm_synthesis": llm_comment,
        "action_plan": {
            "verdict": verdict,
            "confidence": confidence,
            "entry_trigger_price": trust.get("price"),
            "stop_loss_price": stop_price,
            "target_1618_price": target_fibo_1618,
            "wave3_progress": w3,
        },
    }

    return {
        "symbol": symbol.upper(),
        "interval": interval,
        "status": "ok",
        "last_close": last_close,
        "verdict": verdict,
        "confidence": confidence,
        "impulse_score": imp_score["score"],
        "impulse_grade": imp_score["grade"],
        "agents": [agent1, agent2, agent3, agent4],
    }
