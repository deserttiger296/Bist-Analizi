# PU30 Uzun Dönem Testi (yalnız RSI, rastgele girişe karşı)

Üretildi: 2026-10-13T11:20:36+00:00 · `python -m python_bot.scripts.pu30_long_history --period 10y --draws 2000 --seed 20261013`

- Strateji: RSI PU30 `pu30-strict-v3` (1. dip RSI < 30, 2. dip RSI > 30), günlük mumlar; NU70 yalnız çıkış uyarısı.
- Evren: güncel BIST100 listesi, 96/100 hisse (veri yok: CWCME, IPEKE, KOZAA, KOZAL). Veri 2016-10-13 → 2026-10-09 (yfinance, temettü/bölünme düzeltmeli; hisse başına en fazla 10y).
- İşlem kuralları `run_portfolio_backtest` ile aynı: giriş knowable_at sonrası ilk açılış, stop %3.0, hedef %6.0, en fazla 20 bar, NU70 teyidinde ertesi açılışta çıkış, komisyon %0.1 + kayma %0.05 (her yön). Hisse başına aynı anda tek pozisyon; portföy nakit sınırı yok (her sinyal ölçülür).
- Rastgele taban: her hissede, o hissenin işlem sayısı kadar rastgele giriş günü (kuralın girebileceği günler arasından), aynı çıkış kuralları; 2000 tekrar. p değeri: rastgele ortalamanın sinyal ortalamasına ulaştığı veya geçtiği tekrarların oranı (tek yönlü).

## Sonuç: 735 işlem

| Ölçü | İşlem | Sinyal ort. % | Medyan % | Kazanma % | Profit factor | Rastgele ort. % | Rastgele %5–%95 | p |
|---|---|---|---|---|---|---|---|---|
| Kurallı işlem (stop/hedef/20 bar, NU70 çıkış) | 735 | 0.14 | -3.24 | 38.0 | 1.07 | 0.18 | -0.08 … 0.46 | 0.609 |
| Sabit 10 gün tutma | 727 | 0.46 | -0.06 | 49.1 | 1.16 | 1.06 | 0.43 … 1.71 | 0.943 |
| Sabit 20 gün tutma | 702 | 1.75 | 0.36 | 51.4 | 1.47 | 2.82 | 1.83 … 3.80 | 0.961 |

## Aynı gün evrene göre fazla getiri

Her işlemin getirisi eksi aynı gün evrendeki diğer hisselere aynı kuralla girilseydi ortalama getiri (piyasanın o tarihten sonraki genel hareketi çıkarılır). t değeri gün bazında: aynı gün açılan işlemler tek gözlem sayılır.

| Ölçü | İşlem | Giriş günü | Ort. fazla % | Medyan fazla % | Evreni geçme % | t (gün bazında) |
|---|---|---|---|---|---|---|
| Kurallı işlem (stop/hedef/20 bar, NU70 çıkış) | 735 | 320 | 0.06 | -0.73 | 38.6 | -0.07 |
| Sabit 10 gün tutma | 727 | 315 | -0.40 | -0.70 | 43.1 | -2.22 |
| Sabit 20 gün tutma | 702 | 312 | -0.56 | -1.28 | 42.0 | -2.23 |

## Yıllara göre (kurallı işlem, giriş yılı)

| Yıl | İşlem | Ort. % | Medyan % | Kazanma % | Profit factor |
|---|---|---|---|---|---|
| 2016 | 7 | 1.28 | 1.68 | 57.1 | 1.92 |
| 2017 | 43 | 0.82 | -3.24 | 44.2 | 1.48 |
| 2018 | 151 | -0.64 | -3.24 | 28.5 | 0.73 |
| 2019 | 44 | 0.85 | -2.58 | 47.7 | 1.51 |
| 2020 | 7 | -0.68 | -3.24 | 28.6 | 0.71 |
| 2021 | 47 | 0.75 | -3.24 | 44.7 | 1.42 |
| 2022 | 11 | -0.79 | -3.24 | 27.3 | 0.66 |
| 2023 | 42 | 1.13 | -3.24 | 47.6 | 1.67 |
| 2024 | 140 | 0.15 | -3.24 | 37.9 | 1.07 |
| 2025 | 133 | 0.38 | -3.24 | 41.4 | 1.19 |
| 2026 | 110 | -0.24 | -3.24 | 34.5 | 0.89 |

Çıkış nedenleri: STOP 433, TARGET 242, TARGET_GAP 22, STOP_GAP 18, HOLDING_EXPIRY 17, END_OF_DATA 3.

Hisse başına işlem: AGHOL 6, AKBNK 9, AKCNS 6, AKFGY 11, AKSA 6, AKSEN 7, ALARK 12, ALBRK 9, ALFAS 11, ARCLK 20, ASELS 3, ASTOR 5, ASUZU 14, AYDEM 7, BAGFS 9, BERA 6, BIMAS 5, BRISA 10, BRSAN 6, BUCIM 10, CANTE 11, CCOLA 6, CEMAS 7, CIMSA 5, DOAS 11, DOHOL 3, ECILC 10, EGEEN 9, EKGYO 5, ENJSA 5, ENKAI 1, ERBOS 8, EREGL 5, EUPWR 10, EUREN 7, FROTO 6, GARAN 11, GENIL 1, GESAN 6, GLYHO 2, GUBRF 10, GWIND 4, HALKB 11, HEKTS 15, HLGYO 8, ISCTR 9, ISDMR 5, ISGYO 5, ISMEN 3, IZMDC 11, KARSN 4, KCAER 3, KCHOL 8, KMPUR 5, KONTR 7, KONYA 12, KORDS 7, KRDMD 2, KZBGY 3, MAVI 7, MGROS 9, MIATK 3, ODAS 7, OTKAR 10, OYAKC 9, PENTA 6, PETKM 3, PGSUS 14, PSGYO 2, QUAGR 8, SAHOL 4, SASA 10, SELEC 14, SISE 10, SMRTG 9, SNGYO 7, SOKM 9, TABGD 3, TAVHL 10, TCELL 4, THYAO 7, TKFEN 2, TOASO 11, TSKB 3, TTKOM 14, TTRAK 14, TUKAS 9, TUPRS 3, ULKER 12, VAKBN 10, VESBE 13, VESTL 12, YEOTK 4, YKBNK 6, YYLGD 4, ZOREN 20.

## Yorum sınırları

- **Survivorship bias:** evren bugünkü BIST100; geçmişte endeksten çıkan veya kottan silinen hisseler yok.
- İşlemler bağımsız değildir (aynı günlerde birçok hissede sinyal: piyasa çapında düşüşler). Rastgele taban hisseyi eşler ama tarihi eşlemez; aynı gün fazla getiri tarihi eşler ama hisseyi eşlemez. İkisi aynı yönü göstermiyorsa sonuç zamanlama değil piyasa/hisse etkisidir.
- Kural parametreleri (pivot 5/2, aralık 8–60, tepki %3, stop %3, hedef %6) bu veriye göre ayarlanmadı; tek bir kural ölçüldü, çoklu deneme düzeltmesi gerekmez.
- RF/LSTM/MOSTRSI filtreleri burada test edilmez: modeller bu dönemin çoğunu eğitimde gördü. Filtreler için tek dürüst ölçüm [VARIANT_COMPARISON.md](VARIANT_COMPARISON.md).
- Ortalama getiri işlem başınadır; 735 işlemin portföy getirisi değildir.
