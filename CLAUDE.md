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
* Motoru başlatmak için: `python_bot/.venv/Scripts/python.exe -m uvicorn main:app --port 8000` (python_bot/ içinden).
* Eşbütünleşme testi: `GET /api/cointegration?asset_a=GARAN&asset_b=AKBNK` (veya Next.js üzerinden `/api/bist/cointegration`).
* Rejim tespiti: `GET /api/regime?symbol=XU100.IS`.
