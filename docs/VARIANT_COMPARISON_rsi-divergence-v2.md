# Varyant Karşılaştırması (out-of-sample) — ESKİ: esnek kurallar `rsi-divergence-v2`

> 6 Ekim 2026 itibarıyla geçersiz strateji sürümü: esnek eşik PU30/NU70 değildir. Güncel: [VARIANT_COMPARISON.md](VARIANT_COMPARISON.md) (`pu30-strict-v3`).

Üretildi: 2026-10-05T16:40:43+00:00 · `python -m python_bot.scripts.compare_variants`

- Evren: 26 hisse (veri hatası: yok), günlük mumlar.
- Girişler yalnızca **2026-04-02** sonrasında: RF ve LSTM'in ne eğitildiği ne değerlendirildiği dönem.
- Ortak işlem varsayımları: spot, yalnız long, NU70 = çıkış uyarısı; stop %3.0, hedef %6.0, en fazla 20 bar; komisyon %0.1 + kayma %0.05 (her yön); işlem başına özsermaye riski %1.0, en fazla 5 pozisyon; giriş knowable_at sonrası ilk açılış.
- Model eşiği: P(UP) ≥ 0.6 (canlı motorla aynı). Haber filtresi test edilmedi: geçmişe dönük zaman damgalı haber verisi yok.

| Varyant | İşlem | Net getiri % | İşlem başı beklenti % | Ort. kazanç % | Ort. kayıp % | Profit factor | Maks. düşüş % | Piyasada % | Kazanma % |
|---|---|---|---|---|---|---|---|---|---|
| Yalnız RSI | 32 | 4.40 | 0.11 | 4.81 | -3.10 | 1.06 | 5.31 | 22.4 | 40.6 |
| RSI + MOSTRSI | 2 | 0.82 | 1.25 | 5.74 | -3.24 | 1.77 | 1.50 | 2.7 | 50.0 |
| RSI + RF | 0 | 0.00 | 0.00 | 0.00 | 0.00 | — | 0.00 | 0.0 | 0.0 |
| RSI + LSTM | 6 | -5.43 | -2.78 | 0.00 | -2.78 | 0.00 | 5.43 | 12.7 | 0.0 |

| Karşılaştırma | Getiri % |
|---|---|
| Eşit ağırlık al-tut (evren) | 3.30 |
| XU100 al-tut | -4.66 |

**Yorum sınırları:** Tek bir son dönem, az sayıda işlem; hisseler arası korelasyon ve örtüşen işlemler nedeniyle işlemler bağımsız değildir. Bu tablo istatistiksel anlamlılık iddia etmez; yalnızca aynı koşullarda filtrelerin RSI tabanına bir şey ekleyip eklemediğinin ilk, dürüst ölçümüdür. Parametreler bu döneme göre ayarlanmadı.
