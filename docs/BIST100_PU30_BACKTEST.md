# BIST100 Tam Evren RSI PU30/NU70 (`pu30-strict-v3`) Backtest Raporu

Üretildi: 2026-10-16T01:44:57+00:00 · `python -m python_bot.scripts.backtest_pu30_bist100`

## Metodoloji ve Look-Ahead Koruması
- **Evren:** BIST100 (96/100 hisse; veri hatası olanlar: CWCME, IPEKE, KOZAA, KOZAL).
- **Veri Penceresi:** `2023-11-17` → `2026-10-15` (yfinance 730 günlük 1s/4s intraday sınırı ve 2 yıllık 1g geçmiş).
- **Katı Semih Hoca Kuralı (`pu30-strict-v3` / `nu70-strict-v3`):** PU30 için 1. dip RSI(14) **< 30**, 2. dip RSI(14) **> 30**, 2. dip fiyatı < 1. dip fiyatı, ara tepki ≥ %3, dipler arası 8–60 bar, pivot (sol 5, sağ 2).
- **Saatlik Güven Seviyesi (`hourly_trust_level`):** 4s PU30 teyidinden sonra 1s grafikte 2. dibin altına inmeyen ilk kesinleşmiş saatlik dip (`yapi_pivotu`) oluşur; iki dip arasındaki en yüksek saatlik fiyat (`güven tazeleyen tepe`) saatlik kapanışla aşıldığında (`kirildi=True`) bir sonraki bar açılışında giriş yapılır.
- **Ortak İşlem ve Sürtünme Varsayımları:** Başlangıç sermayesi 100,000 TL, spot yalnız-long, NU70 = çıkış uyarısı; zarar kes %3.0, kâr al %6.0, azami tutma 20 bar; komisyon %0.1 + kayma %0.05 (her yön ayrı); işlem başı özsermaye riski %1.0, en fazla 5 eşzamanlı pozisyon. Aynı mumda hem stop hem hedef görülürse muhafazakâr olarak **STOP** önceliklidir.

## Sonuç Tablosu

| Varyant | Periyot | İşlem | Kazanan | Kaybeden | Kazanma % | Net Getiri % | İşlem Başı Beklenti % | Ort. Kazanç % | Ort. Kayıp % | Profit Factor | Maks. Düşüş % | Piyasada % |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 4s Yalnız PU30 (Katı 30/70) | `4h` | 13 | 0 | 13 | 0.0 | -10.38 | -3.24 | 0.00 | -3.24 | 0.00 | 10.39 | 0.8 |
| 4s PU30 + Saatlik Güven Tazeleyen Tepe Kırılımı | `4h` | 365 | 160 | 205 | 43.8 | 22.36 | 0.52 | 5.33 | -3.23 | 1.29 | 27.78 | 67.3 |
| 4s PU30 + 1s PU30 Çapraz Teyit (DOUBLE_BULL) | `4h` | 49 | 16 | 33 | 32.7 | -6.26 | -0.36 | 5.02 | -2.97 | 0.82 | 9.75 | 19.0 |
| 4s PU30 + 1s MOSTRSI Bull | `4h` | 181 | 69 | 112 | 38.1 | -10.28 | 0.00 | 5.34 | -3.29 | 1.00 | 21.03 | 45.4 |
| 1s Yalnız PU30 (SCALP_1H) | `1h` | 22 | 2 | 20 | 9.1 | -12.51 | -2.17 | 5.74 | -2.96 | 0.19 | 14.13 | 1.4 |
| 1g Yalnız PU30 (Günlük Katı 30/70) | `1d` | 49 | 15 | 34 | 30.6 | -10.93 | -0.69 | 5.76 | -3.53 | 0.72 | 19.69 | 16.3 |

| Karşılaştırma (Aynı Pencere) | Getiri % |
|---|---:|
| BIST100 Eşit Ağırlık Al-Tut (2023-11-17 → 2026-10-15) | 29.14 |

## Dürüst Değerlendirme ve Sınırlar
- **Yalnız 4s PU30 vs. Saatlik Güven Seviyesi Kırılımı:** Yalnız 4s PU30 teyit mumunun hemen ardından koşulsuz giriş yapıldığında, düşen bıçak (falling knife) dönemlerinde ilk 13 işlem üst üste stop olmuş (`-%10.38`) ve portföyün `%10` maksimum özsermaye kayıp kesicisi (`max_loss_pct=10.0`) devreye girerek yeni işlemleri durdurmuştur. Buna karşılık **Saatlik Güven Tazeleyen Tepe Kırılımı (`hourly_trust_level`)** beklendiğinde, 2. dibin altına inen bozuk yapılar (`durum="gecersiz"`) elenmiş; strateji 2 yıllık pencerede **365 işlem**, **%43.8 kazanma oranı**, **1.29 profit factor**, işlem başı **+%0.52** net beklenti ve **+%22.36** toplam net getiri üretmiştir.
- **Al-Tut ve Maksimum Düşüş Karşılaştırması:** Saatlik güven seviyesi kırılımı pozitif beklenti (+%22.36) üretse de **%27.78** maksimum düşüş (drawdown) yaşamış ve aynı dönemdeki pasif **BIST100 Eşit Ağırlık Al-Tut (+%29.14)** getirisinin gerisinde kalmıştır.
- **Diğer Varyantlar (`DOUBLE_BULL`, `1s MOSTRSI`, `1s PU30`, `1g PU30`):** `4s PU30 + 1s MOSTRSI Bull` başa baş (`PF 1.00`, beklenti `%0.00`) kalırken, `4s + 1s PU30 DOUBLE_BULL` (`PF 0.82`), `1s Yalnız PU30` (`PF 0.19`) ve `1g Yalnız PU30` (`PF 0.72`) bu pencerede negatif beklenti üretmiştir.
- **Sağlayıcı kısıtları:** yfinance yalnızca hâlen işlem gören hisseleri döndürür (survivorship bias; kottan çıkan/birleşen `KOZAL`, `KOZAA`, `IPEKE`, `CWCME` hariç tutulmuştur); resmi tatil/yarım gün takvimi ve intrabar tick sırası sertifikalı değildir.
