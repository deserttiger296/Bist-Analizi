# PU30 / NU70 Karar Ağacı

> Güncel mimari: MTF yalnız ayrı laboratuvarda çalışır. Klasik motor MTF öncesi davranışına döndürülmüştür. Geçerli entegrasyon: [MTF_LAB_IZOLE_ENTEGRASYON.md](MTF_LAB_IZOLE_ENTEGRASYON.md). Aşağıdaki önceki MTF bağlama anlatımları tarihsel nottur.

> Güncel PU30 işlem statüsü: 15 Ekim kullanıcı talebiyle [PU30_MTF_V4.md](PU30_MTF_V4.md) uygulanır. Aşağıdaki eski çapraz kontrol ve saatlik tepe açıklamaları güncel PU30 alım durumunu tek başına tanımlamaz. NU70 ayrı kalır.

> Kaynak kontrolü (15 Ekim 2026): Aşağıdaki ağaç mevcut uygulamayı anlatır. Hocanın açık sözleri ile uygulama parametreleri ve yorum gerektiren noktalar [SEMIH_KAYNAK_KURALLAR.md](SEMIH_KAYNAK_KURALLAR.md) içinde ayrılmıştır. Ağacın her ayrıntısının hocanın doğrudan ifadesi olduğu doğrulanmış değildir.

Sürüm: `pu30-strict-v3` / `nu70-strict-v3` (6 Ekim 2026). Kaynak: Semih Murat Ersoy mesajları
(2, 5 ve 6 Ekim 2026). Kod karşılığı: `python_bot/engine/signals/rsi_pu30.py`; komut satırı:
`python rsi_divergence_screener.py`; TradingView: `tradingview/rsi_pu30_nu70_mtf.pine`.

```text
                     [Kapanmış mumlarla teyit edilmiş yeni dip / tepe (pivot, sol 5 / sağ 2)]
                                              |
              +-------------------------------+-------------------------------+
              |                                                               |
   DİPLER (fiyat düşüyor)                                          TEPELER (fiyat yükseliyor)
   Fiyat_2 < Fiyat_1   (eşit dip sayılmaz)                         Fiyat_2 > Fiyat_1
   RSI_2   > RSI_1                                                 RSI_2   < RSI_1
   Arada en az %3 tepki; Dip 2 aradaki en düşük nokta              Arada en az %3 geri çekilme; Tepe 2 en yüksek nokta
              |                                                               |
     +--------+---------+                                            +--------+---------+
     |                  |                                            |                  |
 [PU30 — KATI]     [ESNEK PU]                                   [NU70 — KATI]     [ESNEK NU]
 RSI_1 < 30        30 şartı yok                                 RSI_1 > 70        70 şartı yok
 RSI_2 > 30        (5 Ekim, kısa vade /                         RSI_2 < 70        (kısa vade trend)
 (tam 30 sayılmaz)  VİOP 5–15 dk)                               (tam 70 sayılmaz)
     |             PU30 DEĞİLDİR,                                    |             NU70 DEĞİLDİR,
     |             ayrı etiket, varsayılan kapalı                    |             ayrı etiket, varsayılan kapalı
     |                                                               |
 [ZAMAN DİLİMİ TEYİDİ]                                           [ZAMAN DİLİMİ TEYİDİ]
     |                                                               |
 +---+-----------------+------------------------+                +---+-----------------+------------------------+
 |                     |                        |                |                     |                        |
 1s VAR, 4s/G YOK      1s VAR, 4s/G VAR         4s/G VAR,        1s VAR, 4s/G YOK      1s VAR, 4s/G VAR         4s/G VAR,
 ↓                     ↓                        1s YOK ↓         ↓                     ↓                        1s YOK ↓
 TEPKİ                 ANA DÖNÜŞ                ANA DÖNÜŞ,       KISA DÜZELTME         ANA ZİRVE                ZİRVE YORULMASI,
 (kısa işlem,          (trend boyunca           saatlik tetik    (kısa vade çıkış)     (spot: çık,              saatlik güven kıran
 hızlı kâr al)         taşınır)                 beklenir                               VİOP: short)             dip beklenir
```

**Giriş / çıkış seviyesi (saatlik yapı, Hoca'nın ASELS 1s grafiğiyle netleşti).**
NU70: 2. tepenin saatlik zirvesinden sonra zirveyi geçemeyen saatlik tepe oluşur; zirve ile o tepe
arasındaki en düşük saatlik fiyat **güven kıran dip**tir. Saatlik kapanış bunun altına inince sat.
PU30: ayna kural; dibi kıramayan saatlik dip, aradaki en yüksek saatlik fiyat **güven tazeleyen tepe**,
üzerinde saatlik kapanış = al. Yapı henüz oluşmadıysa seviye "bekleniyor" gösterilir; iki pivot
arası uç nokta (eski hesap, `ara_bolge_*`) tetik olarak kullanılmaz.
Doğrulama: ASELS gerçek verisinde zirve 450,00 (6 Mayıs 2026) → güven kıran dip 423,00 → 12 Mayıs
15:30 saatlik kapanış 421,25 ile kırılım; Hoca: "ASELSAN 423'te sat vermiş" (grafiğinde 423,25;
fark TradingView/yfinance veri farkı).

**Spot ve VİOP.** BIST spot hissede NU70 bir *satış / çıkış uyarısıdır*; açığa satış yalnızca VİOP
için geçerlidir. Backtest motoru NU70'i yalnızca çıkış olarak işler.

## Kesinleşen kararlar (gerekçeleriyle)

1. **Pivot fiyatta aranır; 2. dip/tepe RSI'ında dönüş mumu esas alınır (VAKBN 5 Kasım 2026).**
   1. dip/tepede pivot penceresindeki (sol 5 / sağ 2) en uç RSI okunur. 2. dip/tepede ise pencerenin
   solundaki bir mumda RSI 30 altına / 70 üstüne sarkmış olsa bile, **pivot mumunun kendisinde (`p`)**
   veya kuruş farkıyla hemen sağındaki dönüş mumunda (`p+1`) RSI 30 üstünde (PU30) / 70 altında (NU70)
   ise o mumun RSI'ı esas alınır (VAKBN 1sa: 23 Ekim `28,82 TL` RSI `14,80` → 2 Kasım `28,40 TL` çekiç
   mumu RSI `32,11 > 30`, saatlik güven tazeleyen tepe `29,88 TL`).
2. **Kuruş toleranslı ikili dip / tepe (`%0,25`, ISCTR 5 Kasım 2026).**
   Semih Hoca'nın ISCTR 1sa grafiğinde mavi yatay çizgiyle gösterdiği üzere (`23 Ekim 11,64 TL` →
   `30 Ekim–2 Kasım 11,66–11,68 TL`, 2 kuruş / `+%0,17` fark), BIST kademe/kuruş farkıyla oluşan
   yatay ikili dipler (`equal_price_tolerance_pct = 0.25`) PU30/NU70 kapsamında kabul edilir; belirgin
   yüksek dip / düşük tepe (`>%0,25`) kabul edilmez.
3. **Güven seviyesi bir alt periyot yapısından, kırılım mum kapanışıyla ("Günlüğün GVT'si Saatlik, Saatliğin GVT'si 15 Dakikalık").**
   - **Günlük (`1d`) veya 4 Saatlik (`4h`) uyumsuzlukta:** Vade en az **15 gündür** (`SCAN_LIFETIME_BARS["1d"] = 15`); ancak GVT / GKD **1 Saatlik (`1h`)** periyotta aranır ("Günlüğe göre ararsak kâr da gider, bozulması ise saatlik periyoda göre 1 günü bulmaz").
   - **1 Saatlik (`1h`) uyumsuzlukta:** Giriş ve çıkış noktalarında GVT / GKD **15 Dakikalık (`15m`)** periyotta aranır ("Saatlikte uyumsuzluk yakaladık, 15 dakikalığa göre hareket edeceğiz giriş ya da çıkış noktalarında, yoksa öperler; saatlik GVT ararsan 3 lira kazanırsın, 15 dakikalığa göre ara" — ASELS 5 Kasım 2026: 1s NU70 sonrası 15dk GKD `348,00 TL` kırılımı `13:15`'te, ardından `327,50 TL` çözülme; VAKBN 1s PU30 sonrası 15dk GVT `29,10 TL` vs 1s GVT `29,88 TL`).
4. **15 Dakikalık (`15m`) tek başına uyumsuzluk tuzağı ve Saatlik (`1h`) NU70'e evrilme zinciri (PGSUS & ASELS 5 Kasım 2026).**
   - Üst periyot (`1s / 4s / Günlük`) boğa trendindeyken ve henüz **1 Saatlikte (`1h`) NU70 yokken**, **sadece 15 dakikalıkta (`15m`) görülen uyumsuzluklara göre ters işlem (short) açmak çok tehlikelidir**.
   - 15 dakikalık uyumsuzluk bize şunu söyler: **"Öğlene kadar düşerim, öğleden sonra dönüp yeni zirve yapabilirim!"** (PGSUS 5 Kasım 2026: Günlük+4s PU30 ana ralli içindeyken 15dk'da `141,00 → 142,30 TL` RSI `72,4 → 69,9` uyumsuzluğu).
   - **Ne zaman gerçek basış başlar? (ASELS 3–5 Kasım 2026 örneği):** 15 dakikalık uyumsuzluk öğlene kadar düşürür; ardından fiyat **"dönüp eski zirveyi veya bir tık üstünü aldığında"** (`ASELS 360,00 → 359,50 TL`) **1 Saatlik (`1h`) grafikte 2. Tepeyi (NU70)** oluşturur. Saatlik NU70 doğduktan sonra 15dk GKD (`348,00 TL`) kırıldığında kağıt gerçekten çözülür.

TradingView'da `tradingview/rsi_pu30_nu70_mtf.pine` aynı kuralları uygular; güven seviyesi için
1 saatlik grafikte, teyit zaman dilimi 240 ile kullanılmalıdır.

## Matriks / İdeal formülleri: yalnızca ön eleme

```text
PU: RSI(C,14)>30 AND Ref(RSI(C,14),-5)<30 AND L<=Ref(L,-5) AND RSI(C,14)>Ref(RSI(C,14),-5)
NU: RSI(C,14)<70 AND Ref(RSI(C,14),-5)>70 AND H>=Ref(H,-5) AND RSI(C,14)<Ref(RSI(C,14),-5)
```

Bu formüller **PU30 / NU70 sinyali değildir**, hızlı bir ön eleme filtresidir:

- Dip/tepe (pivot) aramaz; son barı tam 5 bar öncesiyle kıyaslar. Hoca'nın dipleri arasında bir
  tepki olur ve genelde 5 bardan uzun sürer.
- Son bar henüz teyit edilmiş bir dip değildir; fiyat düşmeye devam edebilir.
- Aradaki tepki ve "Dip 2 en düşük nokta" şartlarını kontrol etmez.
- `L<=Ref(L,-5)` eşit dibi de kabul eder (2. soru cevap bekliyor).
- Olumlu yanı: 30 ve 70 eşitsizlikleri doğrudur (`>30`, `<30`, `<70`, `>70`).

Kullanım önerisi: Matriks/İdeal'de geniş bir listeyi daraltmak için kullanın; sinyali sitede veya
`python rsi_divergence_screener.py SEMBOL --interval 1h` ile doğrulayın.

## TradingView ile bilinen farklar (bilgi notu — sisteme uygulanmadı)

Sitedeki motor bu farkları bilerek kendi kuralıyla bırakır; TradingView'da karşılaştırırken dikkat edin:

| Konu | Site motoru | TradingView `ta.rsi` |
|---|---|---|
| Fiyat tamamen yatay (hiç değişim yok, örn. işlem durdurma) | RSI = 50 | RSI = 100 |
| Fiyat verisi | yfinance, temettü/bölünme düzeltmeli | Grafik ayarına bağlı (genelde düzeltmesiz) |
| Saatlik mum etiketleri | 09:30 … 17:30 (yfinance) | Sağlayıcıya göre 10:00 … 18:00 olabilir |

Bu yüzden aynı mumda kuruş düzeyinde farklar görülebilir (ör. ASELS güven kıran dip: site 423,00,
TradingView 423,25). Sinyal kuralı aynıdır.
