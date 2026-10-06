# Tam sürüm: RF + LSTM + FinBERT haber analizi + RSI/MOSTRSI tarayıcıları.
# Yalnızca bu bilgisayarda çalışır (modeller python_bot/models altında, Git'e girmez).
# Kullanım (repo kökünden):  powershell -ExecutionPolicy Bypass -File .\start_full.ps1
$root = $PSScriptRoot

# Python motoru: http://127.0.0.1:8001
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root'; .\.venv\Scripts\python.exe -m uvicorn python_bot.main_api:app --host 127.0.0.1 --port 8001"

# Web arayüzü: http://localhost:3000 (SNIPER_ENGINE_URL boşsa 127.0.0.1:8001'e bağlanır)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root'; npm run dev"

# FinBERT ilk açılışta model indirdiği için motorun hazır olması ~30 sn sürebilir.
Start-Sleep -Seconds 30
Start-Process "http://localhost:3000/index.html"
