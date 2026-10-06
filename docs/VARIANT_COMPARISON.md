# Varyant Karşılaştırması (out-of-sample)

Üretildi: 2026-10-06T19:04:17+00:00 · `python -m python_bot.scripts.compare_variants`

- Strateji: RSI PU30/NU70 `pu30-strict-v3` / `nu70-strict-v3` (1. dip RSI < 30, 2. dip RSI > 30; NU ayna kural).
- Evren: 25/26 hisse kullanıldı (ISCTR: HMM özellikleri hesaplanamadı, tüm varyantlardan çıkarıldı), günlük mumlar.
- Girişler yalnızca **2026-04-02** sonrasında: RF ve LSTM'in ne eğitildiği ne değerlendirildiği dönem.
- Ortak işlem varsayımları: spot, yalnız long, NU70 = çıkış uyarısı; stop %3.0, hedef %6.0, en fazla 20 bar; komisyon %0.1 + kayma %0.05 (her yön); işlem başına özsermaye riski %1.0, en fazla 5 pozisyon; giriş knowable_at sonrası ilk açılış.
- Model eşiği: P(UP) ≥ 0.6 (canlı motorla aynı). Haber filtresi test edilmedi: geçmişe dönük zaman damgalı haber verisi yok.

| Varyant | İşlem | Net getiri % | İşlem başı beklenti % | Ort. kazanç % | Ort. kayıp % | Profit factor | Maks. düşüş % | Piyasada % | Kazanma % |
|---|---|---|---|---|---|---|---|---|---|
| Yalnız RSI | 11 | -0.93 | -0.22 | 4.63 | -2.98 | 0.89 | 4.32 | 8.7 | 36.4 |
| RSI + MOSTRSI | 0 | 0.00 | 0.00 | 0.00 | 0.00 | — | 0.00 | 0.0 | 0.0 |
| RSI + RF | 0 | 0.00 | 0.00 | 0.00 | 0.00 | — | 0.00 | 0.0 | 0.0 |
| RSI + LSTM | 2 | -2.15 | -3.24 | 0.00 | -3.24 | 0.00 | 2.61 | 1.5 | 0.0 |

| Karşılaştırma | Getiri % |
|---|---|
| Eşit ağırlık al-tut (evren) | 2.75 |
| XU100 al-tut | -5.19 |

**Yorum sınırları:** Tek bir son dönem, az sayıda işlem; hisseler arası korelasyon ve örtüşen işlemler nedeniyle işlemler bağımsız değildir. Bu tablo istatistiksel anlamlılık iddia etmez; yalnızca aynı koşullarda filtrelerin RSI tabanına bir şey ekleyip eklemediğinin ilk, dürüst ölçümüdür. Parametreler bu döneme göre ayarlanmadı.
