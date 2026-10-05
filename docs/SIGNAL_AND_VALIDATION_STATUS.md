# Sinyal Kuralları ve Doğrulama Durumu

Son güncelleme: 2026-10-05. Bu belge kodla birebir uyumlu tutulmalıdır; kaynak:
`python_bot/engine/signals/rsi_pu30.py`, `most_rsi.py`, `engine/data/provider.py`,
`engine/backtest/backtest_engine.py`.

## 1. RSI PU30 / NU70 (Semih Hoca kuralları)

Referans uygulama: kullanıcının `rsi_uyumsuzluk.py` / `rsi_uyumsuzluk.pine` dosyaları.
2026-10-05'te canlı veride (15 hisse × 1s/4s/1g) motor ile referans **aynı sinyali, aynı
fiyat/RSI değerleriyle** üretti (ISDMR NU, 1g, tepe 62.00/72.32 → 66.25/66.06, tepki %10.0).

| Kural | Varsayılan | Not |
|---|---|---|
| RSI | Wilder RMA, 14 | TradingView `ta.rsi` ile aynı |
| Mod | Esnek (`strict_threshold=False`) | Katı mod = klasik PU30/NU70 |
| Esnek eşik | 1. dip RSI < 55 (PU), 1. tepe RSI > 45 (NU) | **Yalnızca 1. pivota** uygulanır |
| Katı eşik | 1. dip < 30 ve 2. dip > 30 (PU); 1. tepe > 70 ve 2. tepe < 70 (NU) | ±2 tolerans |
| Fiyat / RSI | PU: dip2 fiyat < dip1, dip2 RSI > dip1. NU: tersi | |
| Ara bölge | Dip 2 iki dip arasındaki en düşük nokta; Tepe 2 en yüksek nokta | |
| Pivot | sol 5, sağ 2 bar; pivot RSI = pencere içi min/max | |
| Dipler arası | 8–60 bar | |
| Min tepki | %3 (PU: aradaki tepe/dip1; NU: dip1'e göre geri çekilme) | |
| Sinyal ömrü | 5 bar (teyitten sonra) | |
| Güven kıran / tazeleyen | PU: aradaki en yüksek; NU: aradaki en düşük. `tetiklendi` = son kapanış seviyeyi geçti mi | |
| Çoklu zaman dilimi | 1s taramasında üst teyit 4s **veya** 1g; 4s/1g taramasında alt teyit 1s. `confirmed_timeframes` alanında | |

NU70 bir **satış/çıkış uyarısıdır**; backtest'te açığa satış olarak işlenmez (spot, long-only).

## 2. Zaman ve kapanmamış mum

- `pivot_time`: 2. pivot mumu. `confirm_bar_open`: teyit mumunun açılışı (pivot + 2 bar).
- `knowable_at`: teyit mumunun **kapanış** zamanı = sinyalin gerçekten bilinebildiği an.
- Kapanmamış mumlar sinyal üretmez: pivot penceresindeki tüm mumlar kapanmış olmalı.
- Backtest girişi `knowable_at` sonrasındaki ilk mumun açılışından yapılır.

## 3. Seans hizalaması (yfinance BIST)

- yfinance saatlik BIST barları 09:30…17:30 damgalıdır; 09:30 barı 10:00 açılışını içerir.
- 4s mumları: sabah (etiket 10:00) = 09:30..13:30 barları, kapanış **14:30**;
  öğle (etiket 14:30) = 14:30..17:30 barları, kapanış **18:10**. 1s kapanış = başlangıç + 1 saat.
- **Desteklenmeyen / sertifikasız:** resmi tatil ve yarım gün takvimi, eksik kaynak mumları,
  kurumsal işlemlerin tarihsel (point-in-time) düzeltmesi. Yanıtlarda `calendar_status:
  REGULAR_SESSION_ONLY` ve uyarı olarak raporlanır; sessizce doğru kabul edilmez.

## 4. MOSTRSI (14, VAR 5, %9)

RSI(14) üzerine VAR(5) adaptif ortalama ve %9 takip eden MOST; `bull` kesişimi AL sinyali.
2026-10-05'e kadar tarayıcı veri sağlayıcının yeni `(df, sonuç)` dönüşü yüzünden **her hisse
için sessizce "sinyal yok"** döndürüyordu; düzeltildi. Doğrulanmış performansı yoktur.

## 5. Model ve performans doğrulama durumu

| Bileşen | Durum |
|---|---|
| RF (`local_rf_v2`, 14 özellik, şema `ohlcv-relative-hmm-v2`) | Ortak tarih sınırlı, etiket ufkuna göre purge edilmiş eğitim/seçim/son-test ayrımı. Güncel model: 30 hisse istendi, 26'sı kullanılabildi (ENKAI, FROTO, ASTOR, MGROS: HMM fit'i sayısal olarak başarısız → hariç tutuldu, nötr değerle doldurulmadı). Seçim dönemi doğruluğu **%28.9**; 3 sınıflı naif taban ~%33. P(UP)≥0.60 eşiğini geçen örnek **0**. Kanıtlanmış katkı **yok**. |
| LSTM (`quantum_lstm_v2`) | RF ile aynı özellik hattı ve aynı etiket (P(RF label = UP)); ölçekleyici yalnız eğitim verisine fit; diziler bölüm sınırını aşmaz. Seçim döneminde UP taban oranı %28.8; P≥0.60 iken isabet **%31.5** (308 örnek), tabandan anlamlı farkı yok. |
| Karar modu | ML skorları varsayılan olarak **gölge modda** (`MODEL_DECISION_MODE=shadow`): kaydedilir ve "GÖLGE · doğrulanmamış" olarak gösterilir, AL kararı olarak sunulmaz. |
| Haber analizi | FinBERT, Claude ve sözlük ayrı motor olarak raporlanır (`engine` alanı). Haber yokluğu veya analiz hatası **teyit sayılmaz**. |
| Varyant karşılaştırması | [VARIANT_COMPARISON.md](VARIANT_COMPARISON.md) (2026-04-02 → 2026-10-05, modellerin görmediği dönem, 26 hisse, günlük). Yalnız RSI: 32 işlem, net **+%4.40**, işlem başı +%0.11, PF 1.06, maks. düşüş %5.3. +MOSTRSI: 2 işlem, +%0.82. +RF: **0 işlem**. +LSTM: 6 işlem, hepsi zararlı, **−%5.43**. Eşit ağırlık al-tut +%3.30, XU100 −%4.66. Sonuç: hiçbir filtre RSI tabanına kanıtlanmış katkı yapmadı; RSI tabanının al-tuta üstünlüğü de az işlemle istatistiksel olarak kanıtlanmış değil. Haber filtresi zaman damgalı geçmiş haber olmadığı için **test edilemedi**. |
| İleriye dönük (canlı) performans | **Bugün ölçülemez.** `engine/journal/daily_history.py` değiştirilemez karar kaydını ve ayrı sonuç olaylarını tutar; veri birikmeden sonuç raporlanmamalıdır. |

`docs/` altındaki 2026-10-05 öncesi performans raporları başlarındaki bantla
**DOĞRULANMAMIŞ / TARİHSEL** olarak işaretlenmiştir.

## 6. Bilinen sınırlar

- yfinance yalnızca hâlen işlem gören hisseleri verir (survivorship bias); 1s geçmişi ~730 gün.
- Backtest: aynı mumda stop ve hedef görülürse stop öncelikli (muhafazakâr); gap'te gerçekleşme açılış fiyatı;
  komisyon ve kayma her iki yönde; veri sonunda açık pozisyonlar son kapanıştan kapatılır.
- Canlı Vercel sitesinde Python motoru yoktur: `SNIPER_ENGINE_URL` erişilebilir bir motora
  ayarlanmadıkça tüm taramalar dürüstçe `backend_unavailable` gösterir.
