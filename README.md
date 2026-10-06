# 🎯 BIST Quantum Sniper | Algorithmic Trading Desk
### AI Trading Terminal v2.0 — BIST100 Algoritmik Al-Sat ve Analiz Platformu

BIST100 hisselerini anlık olarak tarayan, derin öğrenme, makine öğrenmesi ve kural tabanlı teknik indikatör kesişimleriyle yüksek olasılıklı al-sat fırsatlarını filtreleyen yeni nesil algoritmik trade terminali.

---

## ⚡ Temel Modüller ve Yetenekler

### 1. 📊 Piyasa Radarı (Sniper Opportunities)
- Tüm BIST100 endeksini anlık olarak tarar.
- **RandomForestClassifier** ile teknik göstergeleri ve XU100 relatif momentum verilerini analiz ederek hissenin yön (UP/DOWN/FLAT) olasılığını hesaplar.
- RF skoru %60 eşiğini geçen hisseler radarda **GÖLGE MOD** etiketiyle listelenir: modelin katkısı geçmiş testte doğrulanmadığı için bu bir AL kararı değildir (bkz. `docs/SIGNAL_AND_VALIDATION_STATUS.md`, `docs/VARIANT_COMPARISON.md`).

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
Terminaldeki ağırlıklar artık `/api/health` üzerinden diskteki RF modelinin gerçek `feature_importances_` değerlerinden gösterilir (eski sabit yüzdeler kaldırıldı).

### 4. 📉 MOSTRSI & RSI PU30 (Kural Tabanlı Özel Motorlar)
- **MOSTRSI (14, close, VAR 5, 9):** Kıvanç Özbilgiç / Anıl Özekşi TradingView formülü. RSI(14) üzerine 5 periyotluk VAR (VIDYA) adaptif hareketli ortalama ve %9 takip eden stop uygulanır. 1 saatlik (`1s`) ve günlük (`1d`) periyotlarda yeşil **Bull** al sinyallerini tespit eder.
- **RSI PU30 (Pozitif Uyumsuzluk):** Fiyat daha düşük bir dip yaparken RSI'ın daha yüksek bir dip yaptığı dönüş formasyonlarını yakalar.

---

## 🚀 Kurulum ve Çalıştırma

### 1. Python Sniper Backend (FastAPI / Port 8001)
`python_bot/` içindeki modüller artık `python_bot.engine...` mutlak import yolunu kullanıyor,
bu yüzden uvicorn **repo kökünden** (`python_bot/`'un bir üstü) ve modül yolu
`python_bot.main_api:app` olarak başlatılmalı — `cd python_bot && uvicorn main_api:app`
`ModuleNotFoundError: No module named 'python_bot'` ile başarısız olur.
```bash
# Sanal ortamı aktive edin (repo kökünde)
.venv\Scripts\activate

# Bağımlılıkları yükleyin
pip install -r python_bot/requirements.txt

# Sniper API & Web Terminalini başlatın (repo kökünden)
uvicorn python_bot.main_api:app --host 0.0.0.0 --port 8001 --reload
```
API ve Web Terminali `http://127.0.0.1:8001` üzerinde yayına girer. Next.js tarafı bu adresi
`SNIPER_ENGINE_URL` ortam değişkeninden okur (bkz. `.env.example`); değişken boşsa
`http://127.0.0.1:8001` varsayılanı kullanılır.

Analitik motor (`python_bot.main:app` — cointegration/regime/kelly-sizing/risk-var; şu an
frontend tarafından çağrılmıyor, bazı fonksiyonları `src/lib/quant/` altında TS olarak yeniden
uygulandı) ayrı ve farklı bir portta (8000) çalıştırılabilir:
```bash
uvicorn python_bot.main:app --host 0.0.0.0 --port 8000 --reload
```

### 2. Next.js Web Frontend (Port 3000)
```bash
npm install
npm run dev
```
Modern web arayüzü `http://localhost:3000` adresinde açılır.

### 3. Tek Tıkla Tam Sürüm (RF + LSTM + FinBERT dahil)
Canlı Vercel sitesi yalnızca RSI/MOSTRSI motorunu çalıştırır; ML modelleri yalnızca bu bilgisayardaki
tam sürümde çalışır. Kök dizinden:
```powershell
powershell -ExecutionPolicy Bypass -File .\start_full.ps1
```
Python motorunu (8001) ve web arayüzünü (3000) iki ayrı pencerede açar, ~30 sn sonra
`http://localhost:3000/index.html` adresini tarayıcıda açar. Terminal Status panelinde RF, LSTM ve
Haber Analizi yeşil görünür.

---

## 🌐 Canlı Yayına Alma (Netlify / Cloud)
Next.js ve statik web terminali Netlify üzerinde sıfır konfigürasyon ile doğrudan derlenecek şekilde optimize edilmiştir (`npm run build`).
Kullanıcılar GitHub reponuzu Netlify'a bağlayarak Continuous Deployment (otomatik güncelleme) avantajından yararlanabilir.


### PU30 kural düzeltmesi — 6 Ekim 2026

Canlı tarama, çapraz zaman dilimi teyidi ve sembol detayları varsayılan olarak
katı PU30 kullanır: **ilk dip RSI < 30, ikinci dip RSI > 30**. Tam 30 kabul
edilmez. Düşük ikinci fiyat ve kapanmış pivot teyidi koşulları da korunur.
`pu30-strict-v3` bu kuralın sürümüdür. `strict_threshold=False` yalnızca açıkça
seçilen eski deneysel uyumsuzluk araştırmaları içindir; API bunu seçmez.
24,8 → 27,7 (KCAER) ve 32,9 → 33,4 (TOASO) PU30 değildir.
Önceki esnek stratejiyle üretilen performans raporları bu sürümü doğrulamaz.

Regresyon: `.venv/Scripts/python.exe -m pytest python_bot/tests/test_pu30_strict.py -q`
Yerel değişiklik canlı siteye ancak yeni dağıtımla yansır.
