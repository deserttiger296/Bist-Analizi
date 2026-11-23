# BIST Pay Vadeli (VİOP) Hesaplama, Teminat ve Risk Yönetimi Teknik Referansı

> **Yasal Uyarı (SPK & Kaldıraç Riski):** Bu doküman yalnızca teknik ve eğitim amaçlı risk yönetimi referansıdır; Sermaye Piyasası Kurulu (SPK) düzenlemeleri kapsamında yatırım danışmanlığı veya al-sat tavsiyesi değildir. VİOP Pay Vadeli sözleşmeleri kaldıraçlıdır; fiyatın ters yönde hareket etmesi halinde yatırılan teminatın tamamı veya fazlası kaybedilebilir. Gerçek Takasbank SPAN Parametrik Risk (PSR) teminatları, aracı kurum komisyonları, BSMV ve seans/teslimat takvimi aracı kurum ve Borsa İstanbul duyurularına göre değişebilir.

---

## 1. Kapsam ve Kaynak Tutarlılığı

Bu teknik şartname, sistemdeki tüm VİOP hesaplamalarının tek doğruluk kaynağıdır (*Single Source of Truth*):

- **Matematik Motoru:** `src/lib/viop.ts` (`computeViopPlan`, `formatViopContractCode`, `buildViopOrderSteps`)
- **Birim Test Paketi:** `scripts/test_viop_calculator.cjs`
- **Etkileşimli Hesaplayıcı ve Emir Planı Arayüzü:** `src/components/ViopCalculator.tsx`
- **Sözlük ve Rehber:** `src/lib/glossary.ts` ve `src/app/viop-rehber/page.tsx`
- **Sinyal Üreticileri:** `python_bot/engine/signals/long_short_matrix.py` ve `python_bot/engine/signals/impulse_wfo.py`

---

## 2. BIST Pay Vadeli Sözleşme Standartları

| Özellik | Resmi / Standart Kural | Sistem Sabiti / Davranışı |
|---|---|---|
| **Dayanak Varlık & Çarpan** | 1 adet Pay Vadeli sözleşme = **100 adet spot pay** | `BIST_STOCK_FUTURES_MULTIPLIER = 100` |
| **Kurumsal Aksiyonlar** | Bedelli/bedelsiz sermaye artırımı ve nakit temettü durumlarında BIST/Takasbank sözleşme çarpanını veya uzlaşma fiyatını uyarlayabilir | Hesaplayıcı standart `100` çarpanını kullanır; kurumsal aksiyon dönemlerinde aracı kurum bülteni kontrol edilmelidir |
| **Sözleşme Kodlama Kuralı** | `F_<SEMBOL><AA><YY>` (ör. `F_THYAO1126` = Kasım 2026 vadeli THYAO) | `formatViopContractCode(symbol, referenceDate)` |
| **Vade Döngüsü & Yıl Sonu** | 3 ardışık yakın ay + Aralık döngüsü; Aralık sonrası yıl değişimi (`1226 → 0127`) | `nearCode` mevcut ay, `nextCode` sonraki ay (`12` → `01` ve `year + 1`) |
| **Vade Sonu & Fiziki Teslimat** | Ayın son iş günü (resmi yarım iş günlerinde bir önceki iş günü). Pay vadelilerde XU030 endeks kontratlarından farklı olarak **fiziki teslimat** uygulanır | `LONG` vade sonuna taşınırsa **nakit temerrüdü**, `SHORT` vade sonuna taşınırsa **kıymet temerrüdü / Takasbank temerrüt alımı** riski doğar |
| **Vade Taşıma (Rollover) Penceresi** | Fiziki teslimat riskinden kaçınmak için vade bitiminden **son 2–3 iş günü** içinde pozisyon kapatılır veya sonraki vadeye taşınır | `inRolloverWindow`: İstanbul takviminde ayın son 3 hafta içi iş günü (`businessDays.length - 3`) ve sonrası. Resmi tatiller/yarım günler son işlem gününü 1 gün öne çekebilir |
| **Normal Seans Saatleri** | Hafta içi `09:30 – 18:10` (sürekli işlem + kapanış/uzlaşma akışı) | Pay Vadeli sözleşmelerde **akşam seansı (19:00 – 23:00) YOKTUR** |
| **Günlük Fiyat Limiti** | BIST Pay Vadeli piyasasında tipik günlük fiyat değişim sınırı `±%20` | Ani taban/tavan kilitlenmelerinde likidite boşluğu (gap) riski oluşabilir |

---

## 3. Takasbank Teminat, Günlük Uzlaşma (MTM) ve Margin Call

### 3.1 Başlangıç ve Sürdürme Teminatı
- **Başlangıç Teminatı (`initialMarginPerContractTry`):** Pozisyon açmak için hesapta bloke edilmesi gereken minimum tutardır. Takasbank SPAN Risk Parametre Dosyası (PSR) ile hisse bazlı belirlenir. Hesaplayıcıda kullanıcı tarafından düzenlenebilir varsayılan simülasyon oranı **`%20`** (`marginRatePct = 20`) olarak alınır.
- **Sürdürme Teminatı (`maintenanceMarginPerContractTry`):**
  - **Resmi Takasbank Kuralı (2017 sonrası):** Gün sonu (EOD) değerlendirmesinde sürdürme teminatı, başlangıç teminatının **`%100`üne** eşittir (`TAKASBANK_MAINTENANCE_MARGIN_RATIO = 1.0`).
  - **Klasik / Gün İçi Erken Uyarı Oranı (`%75`):** Geleneksel ders kitabı oranı ve birçok aracı kurumun gün içi erken uyarı eşiği başlangıç teminatının **`%75`**'idir (`intradayWarning75PerContractTry = initialMarginPerContractTry * 0.75`).
  - **İzleme Eşikleri:** Aracı kurumlar ve Takasbank gün içinde `%75`, `%90` ve `%100` teminat aşım seviyelerinde risk izlemesi uygular; `computeViopPlan` varsayılan olarak resmi `1.0` oranını kullanır ve `maintenanceMarginRatio` parametresi ile `0.75` senaryosunu da destekler.

### 3.2 Günlük Uzlaşma (Mark-to-Market / MTM)
- Pay Vadeli sözleşmelerde her işlem günü sonunda kâr/zarar nakden hesaba yansıtılır.
- **Günlük Uzlaşma Fiyatı:** Normal seansın **son 10 dakikasındaki ağırlıklı ortalama fiyat (VWAP)** esas alınır. Son 10 dakikada yeterli işlem yoksa sırasıyla son 10 işlem, tüm seans ağırlıklı ortalaması veya önceki uzlaşma fiyatı yöntemleri devreye girer.

### 3.3 Teminat Tamamlama Çağrısı (Margin Call)
- Gün sonu uzlaşması (MTM) sonrasında toplam teminat bakiyesi sürdürme teminatı sınırının altına düşerse **Teminat Tamamlama Çağrısı (`Margin Call`)** doğar.
- Eksik tutarın en geç **T+1 günü saat 15:00**'e kadar (aracı kurumların iç operasyon kesimi genellikle **14:30**'dur) nakit olarak tamamlanması veya pozisyonun azaltılması gerekir.
- Süresi içinde karşılanmayan çağrılarda aracı kurum / Takasbank pozisyonu **resen kapatma** yetkisine sahiptir.

---

## 4. İşlem Maliyetleri ve Net Beklenen Değer (EV)

- **BIST Borsa Payı:** Pay Vadeli işlemlerde taraf başı yaklaşık **`%0.003`** (yüzbinde 3).
- **Diğer Kalemler:** Aracı kurum komisyonu + Takasbank saklama/takas payı + komisyon tutarı üzerinden **`%5` BSMV** (Banka ve Sigorta Muameleleri Vergisi).
- **Varsayılan Gidiş-Dönüş Maliyet:** Hesaplayıcıda giriş + çıkış toplamı için varsayılan **`%0.05`** (`commissionPct = 0.05`, kullanıcı tarafından düzenlenebilir) kullanılır.
- **Sistem Karşılaştırması:** Spot ileriye dönük test motoru (`python_bot/engine/signals/impulse_wfo.py`) spot tarafta `%0.25` gidiş-dönüş maliyet varsayarken, `python_bot/engine/shield/expected_value.py` (`ExpectedValueFilter`) komisyon ve kayma sonrası **Net Beklenen Değer (Net EV)** pozitif kalmadıkça işlem onaylamaz. VİOP hedef kârları (`profit1rTry`, `profit2rTry`) her zaman `estCommissionTry` düşülerek **net** hesaplanır.

---

## 5. Matematiksel Model (`src/lib/viop.ts` Kaynak Denklemleri)

Tüm sayısal girdiler `Number.isFinite` ile doğrulanır; `NaN`, `Infinity`, sıfır veya negatif değerlerde hesaplama durdurulur (`isValid = false`, `suggestedContracts = 0`).

### 5.1 Yönlü Stop Mesafesi ve Doğrulama
- `sign = +1` (`LONG`) veya `sign = -1` (`SHORT`).
- `LONG` işlemde zorunlu koşul: `stopPrice < entryPrice`; aksi halde hata döner.
- `SHORT` işlemde zorunlu koşul: `stopPrice > entryPrice`; aksi halde hata döner.
- `stopDistanceTry = direction === "LONG" ? entryPrice - stopPrice : stopPrice - entryPrice`
- `stopDistancePct = (stopDistanceTry / entryPrice) * 100`

### 5.2 Sözleşme ve Teminat Büyüklükleri
- `contractNotionalTry = entryPrice * 100`
- `initialMarginPerContractTry = contractNotionalTry * (marginRatePct / 100)`
- `maintenanceMarginPerContractTry = initialMarginPerContractTry * maintenanceMarginRatio` *(varsayılan oran `1.0`)*
- `intradayWarning75PerContractTry = initialMarginPerContractTry * 0.75`
- `riskPerContractTry = stopDistanceTry * 100`

### 5.3 Stop-Risk Öncelikli Kontrat Boyutlandırma ve Teminat Tavanı
Önce sermayenin işlem başı risk bütçesine göre maksimum kontrat bulunur, ardından mevcut sermayenin karşılayabileceği maksimum başlangıç teminatı tavanı uygulanır:

- `maxRiskBudgetTry = capitalTry * (riskPct / 100)`
- `recommendedContractsByRisk = floor(maxRiskBudgetTry / riskPerContractTry)`
- `maxContractsByMargin = floor(capitalTry / initialMarginPerContractTry)`
- `suggestedContracts = min(recommendedContractsByRisk, maxContractsByMargin)`
- `marginCapped = recommendedContractsByRisk > maxContractsByMargin`

> **Geniş Stop Kuralı:** Eğer 1 kontratın stop riski bile `maxRiskBudgetTry` bütçesini aşıyorsa (`recommendedContractsByRisk === 0`), `suggestedContracts = 0` kalır; **asla zorla `1` kontrata yuvarlanmaz**.

### 5.4 Pozisyon, Teminat Tamponu ve Efektif Kaldıraç
- `totalPositionTry = suggestedContracts * contractNotionalTry`
- `requiredMarginTry = suggestedContracts * initialMarginPerContractTry`
- `maintenanceMarginTotalTry = suggestedContracts * maintenanceMarginPerContractTry`
- `freeMarginBufferTry = capitalTry - requiredMarginTry`
- `effectiveLeverage = totalPositionTry / capitalTry`

**Efektif Kaldıraç Risk Bantları (`leverageWarning`):**
- `effectiveLeverage <= 2.5` → **`SAFE`** *(Düşük / kontrollü kaldıraç)*
- `2.5 < effectiveLeverage <= 4.0` → **`MODERATE`** *(Orta risk — stop ve gün içi teminat disiplini şart)*
- `effectiveLeverage > 4.0` → **`HIGH`** *(Yüksek kaldıraç — margin call ve sert kayıp riski)*

### 5.5 Net `1R` / `2R` Hedef Kâr ve Kayıp
Hedefler kullanıcı/sinyal tarafından verilmemişse otomatik türetilir:
- `resolvedTarget1r = target1r ?? (entryPrice + sign * stopDistanceTry)`
- `resolvedTarget2r = target2r ?? (entryPrice + sign * 2 * stopDistanceTry)`
- `estCommissionTry = totalPositionTry * (commissionPct / 100)`
- `riskLossTry = suggestedContracts * riskPerContractTry`
- `profit1rTry = suggestedContracts > 0 ? sign * (resolvedTarget1r - entryPrice) * 100 * suggestedContracts - estCommissionTry : 0`
- `profit2rTry = suggestedContracts > 0 ? sign * (resolvedTarget2r - entryPrice) * 100 * suggestedContracts - estCommissionTry : 0`

---

## 6. 41 BIST Pay Vadeli Evreni ve Sinyal Güvenlik Kapıları

### 6.1 Standart 41 VİOP Payı (`BIST_VIOP_SYMBOLS`)
`python_bot/engine/signals/long_short_matrix.py` ile birebir senkronize **41 hisse**:

`AEFES`, `AKBNK`, `ARCLK`, `ASELS`, `ASTOR`, `BIMAS`, `CCOLA`, `DOHOL`, `EKGYO`, `ENKAI`, `EREGL`, `FROTO`, `GARAN`, `GUBRF`, `HALKB`, `HEKTS`, `ISCTR`, `KCHOL`, `KRDMD`, `MGROS`, `OYAKC`, `PETKM`, `PGSUS`, `SAHOL`, `SASA`, `SISE`, `SOKM`, `TAVHL`, `TCELL`, `THYAO`, `TOASO`, `TRALT`, `TRMET`, `TSKB`, `TTKOM`, `TTRAK`, `TUPRS`, `ULKER`, `VAKBN`, `VESTL`, `YKBNK`.

*(Not: `KOZAL`, `KOZAA`, `IPEKE` bu listede yer almaz; `TRALT` ve `TRMET` yer alır.)*

### 6.2 Sinyal Güvenlik Tetikleyicileri ("İşlem Açma / Teyit Bekle" Kapıları)
1. **Kırılım Teyidi Eksik (`triggered === false` veya `gkd_broken === false`):** GVT (PU30 alım eşiği) veya GKD (NU70 satış eşiği) henüz kırılmadıysa sinyal yalnızca pusu/izleme aşamasındadır; VİOP'ta erken pozisyon açılmaz.
2. **15 Dakikalık Tek Başına Tuzak (`fractalPhaseCode === "TUZAK_15DK_YENI_ZIRVE_BEKLENIR"`):** Saatlikte (1S) NU70 yokken yalnızca 15dk'da NU70 oluşması *"öğlene kadar düşüp öğleden sonra yeni zirve yapma"* tuzağıdır; kaldıraçlı SHORT yasaktır.
3. **Tepkisiz Düşüş / Şelale (`hasReaction === false`):** RSI 30 altına indikten sonra henüz tepki alımı veya 2. dip (PU30) kurulmadıysa dip avcılığı yapılmaz.
4. **Fraktal Hedef Uyumu:**
   - `SALINIM_SONRA_YENI_ZIRVE` (`1S` NU70 var, `4S` yok): Hedef **`1R`** kısa salınımdır.
   - `CIFT_KILIT_SERT_SATIS` / `KASKAD_15DK_1S_ONAYLI`: Hedef **`2R`** veya kademeli trend takibidir.
