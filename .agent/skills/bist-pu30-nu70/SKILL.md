---
name: bist-pu30-nu70
description: Run and verify BIST RSI PU30/NU70 divergence scans, sub-timeframe GVT/GKD levels (1d/4h -> 1h, 1h -> 15m), 15m->1h fractal trap detection, and Wave 1-2 Impulse + Fibonacci Time projections.
---

# BIST RSI PU30/NU70 & Fraktal GVT/GKD İş Akışı

## 1. Hızlı Tarama Komutları
- **Saatlik (`1h`) Sinyal + `15dk` GVT/GKD Taraması:**
  ```powershell
  .\.venv\Scripts\python.exe rsi_divergence_screener.py VAKBN ISCTR ASELS THYAO --interval 1h
  ```
- **Günlük (`1d`) Sinyal (Min 15 Gün Vade) + `1s` GVT/GKD Taraması:**
  ```powershell
  .\.venv\Scripts\python.exe rsi_divergence_screener.py PGSUS MAVI AKSEN SAHOL TOASO --interval 1d
  ```
- **15 Dakikalık (`15m`) Uyumsuzluk Tuzağı Kontrolü:**
  ```powershell
  .\.venv\Scripts\python.exe rsi_divergence_screener.py PGSUS ASELS --interval 15m
  ```

## 2. Testbed: 1-2 İtki, Fib Zaman ve 1s vs 15dk GVT Kıyaslaması
```powershell
.\.venv\Scripts\python.exe python_bot/scripts/testbed_impulse_fib_time.py PGSUS ASELS VAKBN ISCTR --interval 1h
```

## 3. Çekirdek Kurallar (`python_bot/engine/signals/rsi_pu30.py`)
- **Kuruş Toleransı (`equal_price_tolerance_pct = 0.25`):** İkili dip/tepede `%0.25` yatay fark kabul edilir.
- **Dönüş Mumu RSI Çözümlemesi (`_resolve_dip2_rsi` / `_resolve_peak2_rsi`):** Pivot mumunun kendisinde (`p`) veya sağındaki ilk dönüş mumunda (`p+1`) RSI `>30` (PU30) / `<70` (NU70) ise geçerlidir.
- **Alt Periyot GVT/GKD (`_sub_trust_df`):** `1d`/`4h` sinyalde `1h` GVT/GKD; `1h` sinyalde `15m` GVT/GKD kullanılır.