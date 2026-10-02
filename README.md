# 🎯 BIST Quantum Sniper | Algorithmic Trading Desk
### AI Trading Terminal v2.0 — BIST100 Algoritmik Al-Sat ve Analiz Platformu

BIST100 hisselerini anlık olarak tarayan, derin öğrenme, makine öğrenmesi ve kural tabanlı teknik indikatör kesişimleriyle yüksek olasılıklı al-sat fırsatlarını filtreleyen yeni nesil algoritmik trade terminali.

---

## ⚡ Temel Modüller ve Yetenekler

### 1. 📊 Piyasa Radarı (Sniper Opportunities)
- Tüm BIST100 endeksini anlık olarak tarar.
- **RandomForestClassifier** ile teknik göstergeleri ve XU100 relatif momentum verilerini analiz ederek hissenin yön (UP/DOWN/FLAT) olasılığını hesaplar.
- **%60 Güven Skoru** barajını geçen hisseleri "AL (GÜÇLÜ YÜKSELİŞ)" onayıyla radara yansıtır.

### 2. 🧠 Sistem Mimarisi & Açık Kaynak Motorlar
- **Scikit-Learn (Yapay Zeka):** Karar ağaçları tabanlı çok sınıflı yön kestirimi.
- **PyTorch (Derin Öğrenme - QuantumLSTM):** 30 günlük zaman serisi hafızası ile sıralı fiyat desenlerini yakalayan ikinci doğrulama motoru.
- **SHAP (Açıklanabilir AI - XAI):** Nobel ödüllü Shapley Değerleri teorisiyle her tahmin için hangi göstergenin ne kadar katkı sağladığını şeffafça açıklar.
- **Pandas-TA:** RSI, MACD, Bollinger Bantları, ATR ve EMA göstergelerini C++ hızında hesaplar.
- **HMMlearn (Gizli Markov Modelleri):** Fiyat hareketindeki gizli kaosu çözerek piyasanın AYI (Kriz) mı BOĞA (Ralli) mı olduğunu rejim koduyla tespit eder.
- **FinBERT (Haber Duygu Analizi):** Finansal haberleri NLP ile analiz ederek zaman bozunumlu duyarlılık (sentiment) skoru üretir.
- **VectorBT:** Sinyallerin geçmiş performansını ve risk/getiri oranlarını milisaniyeler içinde simüle eder.
- **YFinance:** BIST hisselerinin anlık ve geçmiş verilerini kesintisiz sağlar.

### 3. ⚖️ AI Karar Ağırlıkları (Feature Importances)
Yapay Zekanın karar verirken arka planda hangi göstergelere ne kadar güvendiğinin matematiksel dökümü:
- **ATR (Volatilite):** %25.41
- **SMA50 (Orta Vade Trend):** %20.96
- **MACD (Momentum):** %17.25
- **RSI (Göreceli Güç):** %14.24
- **EMA9 (Kısa Vade Trend):** %11.98
- **Hacim Oranı (Volume Ratio):** %10.15

### 4. 📉 MOSTRSI & RSI PU30 (Kural Tabanlı Özel Motorlar)
- **MOSTRSI (14, close, VAR 5, 9):** Kıvanç Özbilgiç / Anıl Özekşi TradingView formülü. RSI(14) üzerine 5 periyotluk VAR (VIDYA) adaptif hareketli ortalama ve %9 takip eden stop uygulanır. 1 saatlik (`1s`) ve günlük (`1d`) periyotlarda yeşil **Bull** al sinyallerini tespit eder.
- **RSI PU30 (Pozitif Uyumsuzluk):** Fiyat daha düşük bir dip yaparken RSI'ın daha yüksek bir dip yaptığı dönüş formasyonlarını yakalar.

---

## 🚀 Kurulum ve Çalıştırma

### 1. Python Sniper Backend (FastAPI / Port 8001)
```bash
cd python_bot
# Sanal ortamı aktive edin
.venv\Scripts\activate

# Bağımlılıkları yükleyin
pip install -r requirements.txt

# Sniper API & Web Terminalini başlatın
uvicorn main_api:app --host 0.0.0.0 --port 8001 --reload
```
API ve Web Terminali `http://127.0.0.1:8001` üzerinde yayına girer.

### 2. Next.js Web Frontend (Port 3000)
```bash
npm install
npm run dev
```
Modern web arayüzü `http://localhost:3000` adresinde açılır.

### 3. Tek Tıkla Tüm Sistemi Başlatma
Kök dizindeki PowerShell betiğiyle tüm servisleri (FastAPI, StockSharp, Next.js) tek tıkla başlatabilirsiniz:
```powershell
.\start_all.ps1
```

---

## 🌐 Canlı Yayına Alma (Netlify / Cloud)
Next.js ve statik web terminali Netlify üzerinde sıfır konfigürasyon ile doğrudan derlenecek şekilde optimize edilmiştir (`npm run build`).
Kullanıcılar GitHub reponuzu Netlify'a bağlayarak Continuous Deployment (otomatik güncelleme) avantajından yararlanabilir.
