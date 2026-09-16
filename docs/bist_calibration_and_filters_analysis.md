# BIST Analyst — Kantitatif Kalibrasyon, Güvence Kuralları ve Endeks Parametreleri Analiz Raporu

Bu rapor, sistemin doğruluk oranını artırmak ve piyasa risklerini en aza indirmek amacıyla önerdiğiniz 3 katmanlı iyileştirme mimarisinin (Kalibrasyon, Operasyonel Güvenceler, BIST Dinamikleri) finansal matematik ve quant mühendisliği açısından analizini içermektedir.

---

## KATMAN 1 — Ağırlıkların BIST Verisiyle Kalibrasyonu ve Korelasyon Analizi

### 1. Korelasyon Analizi Metodolojisi (Pearson/Spearman Rank)
İndikatörlerin BIST'teki etkililiğini test etmek amacıyla, her bir göstergenin tetiklendiği $t_0$ gününü baz alıp, ileriye dönük $t+5$, $t+10$ ve $t+20$ iş günü sonrasındaki logaritmik getirilerle ($\ln(P_{t+n}/P_{t_0})$) korelasyon analizi yapılması önerilir:
*   Korelasyon katsayısı ($r$) pozitif ve anlamlı ($p < 0.05$) ise indikatörün katsayısı kademeli artırılır.
*   $r$ değeri nötr veya negatif ise gösterge elenir veya ağırlığı taban seviyeye (%1-2) çekilir.
*   Bu döngü, FastAPI `/api/v1/calibrate` endpoint'i üzerinden haftalık/aylık bazda otomatik çalıştırılacak bir regresyon testiyle yürütülebilir.

### 2. Kritik Ağırlıkların Değerlendirilmesi

*   **3-Günlük EMA 21 (12 Puan - En Yüksek Ağırlık)**: 
    *   *Analiz*: BIST'te 3 günlük grafik yapısı, küçük yatırımcıların günlük dalgalanma gürültüsünü (noise) eler ve kurumsal takas alımlarının (T+2 takas süresi nedeniyle) netleştiği yönü gösterir. Dolayısıyla, **bu yüksek ağırlık BIST'te haklı bir temele sahiptir**. Ancak yine de trend piyasaları dışındaki gücü korelasyon testiyle takip edilmelidir.
*   **CMF Pozitif (8 Puan - Hacim Güvenilirliği)**:
    *   *Analiz*: BIST'te hacim verisi, yüksek frekanslı robotik işlemler (HFT) ve aracı kurumların hacim döndürme (churn) işlemleri nedeniyle manipüle edilmeye oldukça açıktır. Dolayısıyla ham hacmi kullanan CMF (Chaikin Money Flow) BIST'te gürültü üretebilir.
    *   *Öneri*: CMF katsayısı **8'den 5'e düşürülmeli**, bunun yerine "Lot Hacmi" yerine nominal para girişini temsil eden **"TL İşlem Hacmi (Lot $\times$ Fiyat)"** veya **"Kurumsal Takas Net Farkı (Smart Money Flow)"** CMF hesaplamasına girdi olarak beslenmelidir.
*   **RSI Ayı Uyumsuzluğu Cezası (-15 Puan - Agresiflik)**:
    *   *Analiz*: Güçlü boğa trendlerinde (örneğin BIST'in enflasyon rallilerinde) RSI negatif uyumsuzluk üretmesine rağmen fiyat haftalarca yükselmeye devam edebilir. -15 puanlık sert ceza, en güçlü momentum kırılımlarını (breakout) kaçırmamıza neden olur.
    *   *Öneri*: Bu ceza sabit olmamalı, **piyasa rejimine bağlı olarak dinamikleşmelidir**:
        *   *Trending Bull (Boğa)* rejiminde: **-5 Puan** (Hafif fren)
        *   *Range-Bound (Yatay)* rejiminde: **-15 Puan** (Sert blokaj - çünkü yatayda negatif uyumsuzluk genellikle kesin bir dönüş sinyalidir)

---

## KATMAN 2 — Otomatik Sinyal İçin Zorunlu Güvenceler (Risk Shield)

Sistem riskini sınırlandırmak için aşağıdaki filtreler ve portföy kısıtlamaları platforma eklenmelidir:

### 1. Likidite Filtresi (ADTV - Average Daily Trading Volume)
*   *Gerekçe*: Sığ ve likiditesi düşük hisselerde üretilen teknik sinyaller, spekülatif tahta hareketleri nedeniyle yüksek oranda sahte kırılım (fakeout) üretir ve kayma (slippage) riski yaratır.
*   *Öneri*: `scan_results` veya tarayıcı motorunun başlangıcına:
    $$\text{ADTV}_{20} \ge 10,000,000 \text{ TL}$$
    kriteri eklenerek 20 günlük ortalama işlem hacmi 10M TL'nin altında olan hisseler Confluence skoru ne olursa olsun elenmelidir.

### 2. Maksimum Pozisyon Sayısı Limiti (Concentration Limit)
*   *Gerekçe*: Endeksin sert yükseldiği günlerde 30-40 hisse birden "ONAYLI AL" konumuna geçebilir. Bu durum sermaye dağılımını imkansız hale getirir.
*   *Öneri*: Aynı anda yayında olabilecek maksimum "ONAYLI AL" sinyali sınırlandırılmalıdır (örn: **Maksimum 8 adet**). Skorlama havuzundaki hisseler Confluence Skoruna göre sıralanıp sadece en yüksek puana ve likiditeye sahip ilk $N$ hisse aktif sinyal olarak gösterilmelidir.

### 3. Sektör / Korelasyon Sınırlandırması (Sector Clamping)
*   *Gerekçe*: Benzer beta katsayısına sahip hisseler (örneğin bankalar: `ISCTR`, `AKBNK`, `GARAN`, `YKBNK`) genellikle tek bir makro tetikleyiciyle aynı anda sinyal üretir. Hepsini portföye almak sektörel riski maksimize eder.
*   *Öneri*:
    *   Aynı sektör grubundan en fazla **2 hisse** aynı anda "ONAYLI AL" durumuna geçebilmelidir.
    *   Üçüncü banka sinyal verdiğinde, en yüksek Confluence skoruna sahip ilk 2 banka korunmalı, 3. banka bekleme (Izleme) listesinde kalmalıdır.

---

## KATMAN 3 — BIST'e Özgü İki Parametrenin Eklenmesi

### 1. Döviz Kuru Rejimi Bağlantısı (USD/TRY Volatility Filter)
*   *Tasarım*: Mevcut Next.js motorumuz teknik indikatörleri USD-dolar bazlı grafikler üzerinden hesaplayarak zaten kur koruması sağlamaktadır. Ancak makro riskleri yönetmek için bir **"Döviz Volatilite Filtresi"** eklenmelidir:
    *   USD/TRY kurunun günlük volatilitesi veya 5 günlük ATR değeri normalin üzerine çıktığında (yani kurda devalüasyon veya sert oynaklık baskısı varken), tüm hisselerin Confluence skorlarına otomatik olarak **0.85x makro risk katsayısı** uygulanmalıdır.
    *   Kur stabilken katsayı **1.0x** olarak kalır.

### 2. Endeks Relatif Gücü (Index Relative Momentum)
*   *Tasarım*: Endeksin düştüğü veya zayıfladığı dönemlerde hisselerin tekil yükselişleri genellikle boğa tuzağıdır. Sisteme hissenin BIST 100 endeksine göre momentumunu gösteren bir filtre eklenmelidir:
    $$\text{Relatif Güç} = \frac{\text{Hisse Fiyatı}}{\text{BIST 100 Endeksi}}$$
    *   Bu oran 10 günlük basit hareketli ortalamasının üzerindeyse hisse endeksten **güçlü** (Outperforming) kabul edilir ve Confluence skoruna **+5 puan** eklenir.
    *   Oran MA'nın altındaysa (yani hisse endeksten zayıf performans gösteriyorsa) Confluence skorundan **-8 puan** düşürülür ve "ONAYLI AL" alması zorlaştırılır.

---

## Sonuç ve Yol Haritası

Önerdiğiniz bu üç katman, sistemi salt bir "indikatör tarayıcı" olmaktan çıkarıp **kurumsal düzeyde bir portföy yönetim sistemine (OMS)** dönüştürecektir. Geliştirme sürecimizde:
1.  Öncelikle **Katman 2 (Likidite ve Sektör Filtreleri)** entegre edilmeli (canlı işlem güvencesi için en kritik olanı).
2.  Ardından **Katman 3 (Döviz Rejimi ve Relatif Güç)** gösterge puanlama sistemine dahil edilmelidir.
3.  Son aşamada ise **Katman 1 (FastAPI Korelasyon Analizi)** ile döngü tamamlanmalıdır.
