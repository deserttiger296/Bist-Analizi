# PU30 / NU70 Karar Ağacı

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

1. **Pivot fiyatta aranır.** Hoca'nın tanımı fiyat üzerinden ("fiyat bir tepki sonrası düşmeye devam
   ediyor ve 2. dibi … yapıyor"); referans `rsi_uyumsuzluk.py` de fiyat pivotu kullanır. Pivotun RSI
   değeri, pivot penceresindeki (sol 5 / sağ 2) en düşük / en yüksek RSI'dır; böylece RSI dibi ile
   fiyat dibi birkaç mum kaysa da doğru RSI değeri okunur.
2. **Eşit dip / eşit tepe sayılmaz.** "Düşmeye devam ediyor" / "fiyat yükselse de" ifadeleri daha
   düşük dip / daha yüksek tepe demektir; eşit seviye ikili dip/tepedir, uyumsuzluk değildir.
3. **Güven seviyesi saatlik yapıdan, kırılım mum kapanışıyla.** Tanım Hoca'nın ASELS grafiğinden
   (yukarıda). İğne sahte kırılım üretir ve kapanmamış mumdan sinyal üretmemek sistemin temel
   kuralıdır; ASELS örneği kapanışla birebir tuttu (12 Mayıs 15:30 kapanış 421,25).

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
