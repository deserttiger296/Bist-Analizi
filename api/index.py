"""
Vercel Python function: the lightweight BIST signal engine, served under /api/py
on the same deployment as the Next.js site (rewrite in next.config.ts).

It runs the RSI PU30/NU70 and MOSTRSI scanners on live yfinance data. The ML
models (RF/LSTM/FinBERT) need scikit-learn/torch/transformers, which exceed the
Vercel function size limit; they are reported as unavailable here -- never
simulated. They also have no demonstrated out-of-sample contribution
(docs/VARIANT_COMPARISON.md). The full engine is `python_bot.main_api`.
"""
import sys
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from python_bot.signal_api import router as signal_router  # noqa: E402

DEPLOYMENT = "vercel-lite"
ML_UNAVAILABLE = (
    "RF/LSTM/haber analizi bu ücretsiz Vercel dağıtımında çalışmıyor (paket boyutu sınırı). "
    "Bu modellerin doğrulanmış katkısı da yok (docs/VARIANT_COMPARISON.md); RSI PU30/NU70 taramasını kullanın."
)

engine = FastAPI(title="BIST Signal Engine (Vercel lite)", docs_url=None, redoc_url=None, openapi_url=None)
engine.include_router(signal_router)


@engine.get("/api/health")
def health():
    return {
        "status": "ok",
        "deployment": DEPLOYMENT,
        "calculated_at": datetime.now(timezone.utc).isoformat(),
        "rf_model": {"present": False, "note": "Bu dağıtımda yok"},
        "lstm": {"torch_installed": False, "weights_present": False, "scaler_present": False, "usable": False},
        "shap_explainability": {"installed": False},
        "sentiment_engine": "none",
    }


def _ml_unavailable():
    return JSONResponse(status_code=501, content={
        "status": "model_unavailable", "deployment": DEPLOYMENT, "data": None,
        "attempted": 0, "scanned": 0, "errors": [], "detail": ML_UNAVAILABLE,
        "calculated_at": datetime.now(timezone.utc).isoformat(),
    })


@engine.get("/api/scan_all")
def scan_all():
    return _ml_unavailable()


@engine.post("/api/predict")
def predict():
    return _ml_unavailable()


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/api/py", engine)
