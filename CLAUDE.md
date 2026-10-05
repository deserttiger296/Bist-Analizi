# Nicel Ticaret Sistemi Proje Kılavuzu

## Yazılım Mimarisi
Nicel (quant) motor artık `python_bot/` altında konsolide edilmiş durumda (eskiden `src/core/` ve `src/tools/` içinde dağınık haldeydi, o dosyalar silindi):
* `python_bot/engine/brain/`: ML/alfa katmanı — feature engineering, dynamic weighting, sentiment, meta-learning, HMM rejim tespiti.
* `python_bot/engine/shield/`: Risk yönetimi — Kelly sizing, VaR, korelasyon matrisi.
* `python_bot/engine/sniper/`: Emir yürütme mantığı (execution router, shadow stop) — şu an hiçbir canlı akışa bağlı değil.
* `python_bot/engine/stat_arb.py`: Engle-Granger ve Johansen eşbütünleşme testleri (matematiksel çekirdek).
* `python_bot/engine/execution/`: Broker webhook dispatcher — kasıtlı olarak pasif, bkz. proje belleği.

## Kodlama Standartları
* Tüm matematiksel hesaplamalarda `numpy.float64` veri tipi zorunludur.
* Veri çerçevelerinde vektörel işlemler tercih edilmeli, `for` döngülerinden kaçınılmalıdır.
* Zaman serisi doğrulamalarında ileriye dönük doğrulama (walk-forward validation - WFO) uygulanmalıdır.
* API anahtarları ve gizli bilgiler asla kod içerisine gömülmemeli, `.env` / `.env.local` dosyasından okunmalıdır.

## Test ve Doğrulama Komutları
* `python_bot/` altındaki tüm modüller `python_bot.engine...` mutlak importu kullanır; bu yüzden
  her komut **repo kökünden** (`.venv/Scripts/python.exe`, `python_bot/` değil kökteki `.venv`)
  çalıştırılmalıdır. `cd python_bot && uvicorn main_api:app` artık ÇALIŞMAZ.
* Sinyal motorunu (RF/LSTM/sentiment/RSI PU30/NU70 — frontend'in fiilen çağırdığı backend)
  başlatmak için: `.venv/Scripts/python.exe -m uvicorn python_bot.main_api:app --port 8001`
  (repo kökünden). Next.js `SNIPER_ENGINE_URL` ortam değişkeni ile bu adrese bağlanır
  (varsayılan `http://127.0.0.1:8001`, bkz. `src/lib/backend.ts`, `src/lib/sniperEngine.ts`,
  `src/lib/rsiPu30Engine.ts`).
* Analitik motoru (cointegration/regime/kelly-sizing/risk-var — şu an frontend tarafından
  çağrılmıyor, `src/lib/quant/pairs.ts` ve `regime.ts` içinde TS karşılıkları var) ayrı bir
  portta (8000) başlatmak için: `.venv/Scripts/python.exe -m uvicorn python_bot.main:app --port 8000`.
* Python testleri: `.venv/Scripts/python.exe -m pytest python_bot/tests/ -v` (repo kökünden).
* Eşbütünleşme testi: `GET http://127.0.0.1:8000/api/cointegration?asset_a=GARAN&asset_b=AKBNK`.
* Rejim tespiti: `GET http://127.0.0.1:8000/api/regime?symbol=XU100.IS`.
