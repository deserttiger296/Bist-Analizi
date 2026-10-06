import os
import sys
import time
import json
from datetime import datetime, timezone
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import joblib
from python_bot.engine.brain.local_classifier import predict as predict_rf, MODEL_PATH as RF_MODEL_PATH
from python_bot.engine.brain.deep_model import predict_lstm, TORCH_AVAILABLE
from python_bot.engine.brain.logger import log_prediction
from python_bot.engine.brain.finbert_sentiment import FinBertSentimentAnalyzer
from python_bot.engine.brain.meta_learning import MetaLearningCalibrationEngine
from python_bot.engine.journal.daily_history import get_history, resolve_pending_outcomes
from python_bot.signal_api import router as signal_router
import yfinance as yf
import numpy as np

# --- SHAP (optional, graceful fallback) ---
_shap_explainer = None
_shap_model_classes = None
_shap_available = False
try:
    import shap
    import joblib
    from python_bot.engine.brain.local_classifier import MODEL_PATH, FEATURE_COLUMNS
    _shap_available = True
except ImportError:
    shap = None
    print("[SHAP] shap package not installed. XAI will use rule-based fallback.")

# "shadow" (default): ML scores are logged and shown as experimental, never as a decision.
# "decide" only after the variant comparison shows a real out-of-sample contribution.
MODEL_DECISION_MODE = os.environ.get("MODEL_DECISION_MODE", "shadow")

_PYTHON_BOT_ROOT = Path(__file__).resolve().parent
if str(_PYTHON_BOT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PYTHON_BOT_ROOT))


app = FastAPI(title="BIST AI Sniper API", version="2.0.0")

# Enable CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files
app.mount("/static", StaticFiles(directory=str(_PYTHON_BOT_ROOT / "static")), name="static")

# --- Global Singletons ---
sentiment_analyzer = FinBertSentimentAnalyzer(use_gpu=False)
meta_engine = MetaLearningCalibrationEngine(lookback_days=14)


def _init_shap_explainer():
    """Lazy-load SHAP TreeExplainer once the RF model is available."""
    global _shap_explainer, _shap_model_classes
    if _shap_available and _shap_explainer is None:
        try:
            if MODEL_PATH.exists():
                payload = joblib.load(MODEL_PATH)
                model = payload["model"]
                # shap.TreeExplainer wraps the model in an internal TreeEnsemble
                # that has no .classes_ -- capture it from the real sklearn model
                # here, before wrapping, rather than reading it off the explainer.
                _shap_model_classes = list(model.classes_)
                _shap_explainer = shap.TreeExplainer(model)
                print("[SHAP] TreeExplainer initialized successfully.")
        except Exception as e:
            print(f"[SHAP] Failed to init explainer: {e}")


class PredictionRequest(BaseModel):
    symbol: str

@app.get("/")
def root():
    return FileResponse(str(_PYTHON_BOT_ROOT / "static" / "index.html"))


@app.get("/api/health")
def health_check():
    """Reports what's actually usable right now -- never a blanket 'ok'.
    A missing model or dependency here means /api/predict and /api/scan_all
    will return per-symbol errors, not fabricated signals; this endpoint is
    how the frontend (or an operator) can tell that apart from a real outage."""
    rf_model = {"present": RF_MODEL_PATH.exists()}
    if rf_model["present"]:
        try:
            payload = joblib.load(RF_MODEL_PATH)
            rf_model.update({
                "model_version": payload.get("model_version"),
                "feature_schema_version": payload.get("feature_schema_version"),
                "training_start": payload.get("training_start"),
                "training_end": payload.get("training_end"),
                "validation_method": payload.get("validation_method"),
                "validation_results": payload.get("validation_results"),
                "skipped_symbols": payload.get("skipped_symbols"),
                "feature_importances": sorted(
                    ({"feature": f, "importance": float(v)} for f, v in
                     zip(payload["feature_columns"], payload["model"].feature_importances_)),
                    key=lambda x: -x["importance"]),
            })
        except Exception as e:
            rf_model["present"] = False
            rf_model["error"] = f"Model dosyası bozuk veya okunamıyor: {e}"

    lstm_weights = _PYTHON_BOT_ROOT / "models" / "quantum_lstm.pth"
    lstm_scaler = _PYTHON_BOT_ROOT / "models" / "lstm_scaler.joblib"

    return {
        "status": "ok",
        "calculated_at": datetime.now(timezone.utc).isoformat(),
        "rf_model": rf_model,
        "lstm": {
            "torch_installed": TORCH_AVAILABLE,
            "weights_present": lstm_weights.exists(),
            "scaler_present": lstm_scaler.exists(),
            "usable": TORCH_AVAILABLE and lstm_weights.exists() and lstm_scaler.exists(),
        },
        "shap_explainability": {"installed": _shap_available},
        "sentiment_engine": "finbert" if sentiment_analyzer.model_loaded else "lexicon_fallback",
    }

from python_bot.engine.universe import BIST100_SYMBOLS

# USD Rate Cache
_USD_RATE = 34.0
_USD_LAST_FETCH = 0

def get_usd_rate():
    global _USD_RATE, _USD_LAST_FETCH
    # Fetch once every hour to save API calls
    if time.time() - _USD_LAST_FETCH > 3600:
        try:
            usd_data = yf.Ticker("USDTRY=X").history(period="1d")
            if not usd_data.empty:
                _USD_RATE = usd_data['Close'].iloc[-1]
                _USD_LAST_FETCH = time.time()
        except:
            pass
    return _USD_RATE


# ─── SHAP Feature Name → Turkish XAI Label Mapping ──────────────────────────
SHAP_FEATURE_LABELS = {
    "rsi_14": ("RSI (Göreceli Güç)", "Hissenin aşırı alım/satım durumunu ölçer"),
    "close_over_ema9": ("EMA9 (Kısa Vade Trend)", "Fiyatın 9 günlük ortalamasına göre konumunu gösterir"),
    "close_over_sma50": ("SMA50 (Orta Vade Trend)", "Fiyatın 50 günlük ortalamasına göre konumunu gösterir"),
    "volume_ratio": ("Hacim Oranı", "Son 20 günlük ortalamaya göre işlem hacmi yoğunluğu"),
    "macd": ("MACD", "Momentum gücünü ve trend yönünü ölçer"),
    "macd_hist": ("MACD Histogram", "Alıcı/Satıcı baskısının hızını gösterir"),
    "macd_signal": ("MACD Sinyal", "MACD ve sinyal çizgisi kesişimini takip eder"),
    "bb_bandwidth": ("Bollinger Bant Genişliği", "Fiyat volatilitesinin genişleme/daralma durumunu ölçer"),
    "bb_percent": ("Bollinger %B", "Fiyatın Bollinger bantları içindeki pozisyonunu gösterir"),
    "atr_14": ("ATR (Volatilite)", "14 günlük ortalama fiyat değişim aralığını ölçer"),
    "regime_code": ("HMM Rejim Kodu", "Saklı Markov Modeli piyasa rejimini sınıflandırır"),
    "regime_confidence": ("Rejim Güveni", "Piyasa rejim sınıflandırmasının güven skoru"),
    "rel_return_5d": ("Göreceli Güç (5G)", "Hissenin son 5 günde XU100 endeksine göre relatif performansı"),
    "rel_return_20d": ("Göreceli Güç (20G)", "Hissenin son 20 günde XU100 endeksine göre relatif performansı"),
}


def _compute_shap_explanation(result: dict) -> dict:
    """
    Compute SHAP feature attributions for a single prediction.
    Returns a dict with shap_values, shap_labels for the UI.
    """
    _init_shap_explainer()
    if _shap_explainer is None:
        return {}

    try:
        feats = result.get("features", {})
        feature_vector = np.array([[feats.get(col, 0.0) for col in FEATURE_COLUMNS]])

        shap_values = _shap_explainer.shap_values(feature_vector)

        # For multi-class (UP/DOWN/FLAT), get the UP class SHAP values
        classes = _shap_model_classes or []
        up_idx = classes.index("UP") if "UP" in classes else 0

        if isinstance(shap_values, list):
            # Older SHAP: list of (n_samples, n_features) arrays, one per class.
            sv = shap_values[up_idx][0]  # shape: (n_features,)
        elif shap_values.ndim == 3:
            # Newer SHAP: single (n_samples, n_features, n_classes) array.
            sv = shap_values[0, :, up_idx]  # shape: (n_features,)
        else:
            sv = shap_values[0]

        # Build ranked feature attribution list
        attributions = []
        for i, col in enumerate(FEATURE_COLUMNS):
            label_info = SHAP_FEATURE_LABELS.get(col, (col, ""))
            attributions.append({
                "feature": col,
                "label_tr": label_info[0],
                "description_tr": label_info[1],
                "shap_value": round(float(sv[i]), 6),
                "abs_importance": round(abs(float(sv[i])), 6),
                "direction": "BULLISH" if sv[i] > 0 else ("BEARISH" if sv[i] < 0 else "NEUTRAL"),
            })

        # Sort by absolute importance
        attributions.sort(key=lambda x: x["abs_importance"], reverse=True)

        return {
            "shap_attributions": attributions,
            "shap_base_value": round(float(_shap_explainer.expected_value[up_idx]), 6) if isinstance(_shap_explainer.expected_value, (list, np.ndarray)) else round(float(_shap_explainer.expected_value), 6),
            "shap_engine": "TreeExplainer",
        }
    except Exception as e:
        print(f"[SHAP] Explanation error: {e}")
        return {}


def _fetch_news_sentiment(symbol: str) -> dict:
    """Fetch recent news for a symbol and compute sentiment score."""
    try:
        ticker = yf.Ticker(f"{symbol}.IS" if not symbol.endswith(".IS") else symbol)
        news = ticker.news
        if not news:
            return {"sentiment_score": 0.0, "sentiment_label": "NEUTRAL", "news_count": 0, "engine": "No_News"}

        headlines = []
        for item in news[:10]:  # Last 10 news items
            title = item.get("title", "")
            if title:
                headlines.append(title)

        if not headlines:
            return {"sentiment_score": 0.0, "sentiment_label": "NEUTRAL", "news_count": 0, "engine": "No_News"}

        agg_score = sentiment_analyzer.aggregate_news_sentiment(headlines)
        label = "POSITIVE" if agg_score > 0.1 else ("NEGATIVE" if agg_score < -0.1 else "NEUTRAL")

        return {
            "sentiment_score": round(agg_score, 4),
            "sentiment_label": label,
            "news_count": len(headlines),
            "engine": "FinBERT_Lexicon",
            "headlines_analyzed": headlines[:3],  # Return top 3 for UI display
        }
    except Exception as e:
        print(f"[Sentiment] Error for {symbol}: {e}")
        return {"sentiment_score": 0.0, "sentiment_label": "NEUTRAL", "news_count": 0, "engine": "Error"}


def _process_prediction(result, symbol=""):
    # Load adaptive thresholds from meta-learning engine
    meta_weights = meta_engine.weights
    rf_threshold = meta_weights.get("rf_threshold", 0.60)
    lstm_threshold = meta_weights.get("lstm_threshold", 0.60)

    prob_up = result["class_probabilities"].get("UP", 0)

    if prob_up >= rf_threshold:
        # In shadow mode the RF score is recorded but never presented as a buy decision:
        # its out-of-sample contribution has not been demonstrated (docs/SIGNAL_AND_VALIDATION_STATUS.md).
        sniper_label = "GÖLGE: RF skoru eşik üstü (doğrulanmamış)" if MODEL_DECISION_MODE == "shadow" else "AL (GÜÇLÜ YÜKSELİŞ)"
        sniper_approved = True
    else:
        sniper_label = "İZLE (RİSKLİ/YATAY)"
        sniper_approved = False

    result["decision_mode"] = MODEL_DECISION_MODE
    result["sniper_label"] = sniper_label
    result["sniper_approved"] = sniper_approved
    result["sniper_threshold"] = rf_threshold
    result["meta_weights"] = meta_weights
    
    # --- SHAP-Driven Explainable AI (XAI) ---
    shap_data = _compute_shap_explanation(result)
    reasons = []

    if shap_data and shap_data.get("shap_attributions"):
        result.update(shap_data)
        # Generate Turkish explanations from SHAP attributions (top 5 most impactful)
        for attr in shap_data["shap_attributions"][:5]:
            direction_tr = "YÜKSELİŞ'e katkı sağlıyor" if attr["direction"] == "BULLISH" else "DÜŞÜŞ riskini artırıyor"
            reasons.append(
                f"[{attr['label_tr']}]: {attr['description_tr']}. "
                f"Bu gösterge şu an {direction_tr} (SHAP: {attr['shap_value']:+.4f})."
            )
    else:
        # Fallback to rule-based XAI if SHAP unavailable
        feats = result.get("features", {})
        rsi = feats.get("rsi_14", 50)
        macd_hist = feats.get("macd_hist", 0)
        
        if rsi < 40:
            reasons.append(f"[RSI: {rsi:.1f}] Göstergesi Düşük: Hisse son günlerde gereğinden fazla düşmüş, ucuzlamış (fırsat bölgesi).")
        elif rsi > 70:
            reasons.append(f"[RSI: {rsi:.1f}] Göstergesi Yüksek: Hisse son günlerde çok hızlı yükselmiş, her an kâr satışları (düşüş) başlayabilir.")
            
        if macd_hist > 0:
            reasons.append("[MACD Histogram Pozitif]: Piyasada bu hisseye olan alıcı ilgisi (para girişi) hızla artıyor.")
        else:
            reasons.append("[MACD Histogram Negatif]: Bu hissede satıcılar daha baskın (para çıkışı) görünüyor.")
            
        bb_percent = feats.get("bb_percent", 0.5)
        if bb_percent < 0:
            reasons.append("[Bollinger Destek Kırılımı]: Fiyat aşırı düştü ve alt bandın altına sarktı (Panik satışı / Dip Fırsatı).")
        elif bb_percent > 1:
            reasons.append("[Bollinger Direnç Kırılımı]: Fiyat direnci kırdı ve yukarı yönde aşırı taştı (Sert yükseliş hareketi).")
            
        volume_ratio = feats.get("volume_ratio", 1.0)
        if volume_ratio > 1.5:
            reasons.append(f"[Hacim Patlaması]: Hissede son 20 günün ortalamasının {volume_ratio:.1f} katı işlem hacmi var. Tahtada balina/kurumsal hareketliliği var!")
            
        close_ema9 = feats.get("close_over_ema9", 0.0)
        if close_ema9 > 0.03:
            reasons.append("[Kısa Vade Trend Pozitif]: Hisse ortalamaların üstünde uçuyor, yükseliş ivmesi çok güçlü.")
        elif close_ema9 < -0.03:
            reasons.append("[Kısa Vade Trend Negatif]: Hisse kısa vadeli ortalamasının altına inmiş durumda, güçsüz seyrediyor.")

    # HMM Regime (always shown)
    feats = result.get("features", {})
    regime_code = feats.get("regime_code", 0)
    if regime_code == 1:
        reasons.append("[HMM Rejimi = TREND]: Borsanın genel gidişatı çok olumlu (Boğa Piyasası), rüzgarı arkamıza aldık.")
    elif regime_code == 2:
        reasons.append("[HMM Rejimi = KRİZ]: Borsanın genel gidişatı olumsuz (Ayı Piyasası), tehlikeli sular.")
        
    if sniper_approved:
        reasons.append(f"[RandomForest > %{int(rf_threshold*100)}]: Klasik Yapay Zeka (Anlık Veri) YÜKSELİŞ bekliyor.")
        
    # --- DUAL-ENGINE CROSS CHECK (Derin Öğrenme Entegrasyonu) ---
    lstm_prob = None
    quantum_approved = False
    # approved | rejected | not_run (RF didn't approve) | unavailable (no torch/model) | error: ...
    lstm_status = "not_run"

    if sniper_approved and symbol != "":
        try:
            lstm_prob = predict_lstm(symbol)
            if lstm_prob is None:
                lstm_status = "unavailable"
            else:
                result["lstm_probability"] = lstm_prob
                if lstm_prob > lstm_threshold:
                    quantum_approved = True
                    lstm_status = "approved"
                    reasons.append(f"[LSTM %{int(lstm_prob*100)} - doğrulanmamış model]: Derin öğrenme skoru eşiğin üzerinde (kalibre edilmiş olasılık değildir).")
                else:
                    lstm_status = "rejected"
                    reasons.append(f"[DİKKAT - LSTM %{int(lstm_prob*100)}]: Derin öğrenme skoru eşiğin altında; çapraz onay yok.")
        except Exception as e:
            lstm_status = f"error: {e}"
    result["lstm_status"] = lstm_status

    # --- TRIPLE-ENGINE: SENTIMENT CONFLUENCE ---
    sentiment_data = {}
    sentiment_approved = False
    if symbol != "":
        sentiment_data = _fetch_news_sentiment(symbol)
        result["sentiment"] = sentiment_data
        sentiment_score = sentiment_data.get("sentiment_score", 0.0)
        sentiment_label = sentiment_data.get("sentiment_label", "NEUTRAL")

        if sentiment_score > 0.0:
            sentiment_approved = True
            reasons.append(f"[HABER DUYGU ANALİZİ: {sentiment_label} ({sentiment_score:+.2f})]: Piyasadaki son haberler pozitif yönlü. Sentiment onayı alındı ✅")
        elif sentiment_score < -0.1:
            reasons.append(f"[DİKKAT - HABER ANALİZİ: {sentiment_label} ({sentiment_score:+.2f})]: Piyasadaki haberler negatif. Sentiment onayı alınamadı ⚠️")
        else:
            reasons.append(f"[HABER ANALİZİ: NÖTR ({sentiment_score:+.2f})]: Piyasadaki haberler nötr seyrediyor.")

    # Confluence level
    confluence_engines = sum([sniper_approved, quantum_approved, sentiment_approved])
    result["quantum_approved"] = quantum_approved
    result["sentiment_approved"] = sentiment_approved
    result["confluence_level"] = confluence_engines
    result["confluence_label"] = {
        3: "ÜÇLÜ ONAY (RF + LSTM + Sentiment) ✅✅✅",
        2: "İKİLİ ONAY ✅✅",
        1: "TEKLİ ONAY ✅",
        0: "ONAY YOK ❌",
    }.get(confluence_engines, "ONAY YOK ❌")

    result["explanation"] = reasons
    
    # Target Price Calculation (Volatilite / ATR Bazlı Hedef)
    atr = feats.get("atr_14", 0)
    current_price = result.get("current_price", 0)
    
    if current_price > 0 and atr > 0:
        target_tl = current_price + (2.5 * atr)
        usd_rate = get_usd_rate()
        target_usd = target_tl / usd_rate
        
        result["target_price_tl"] = target_tl
        result["target_price_usd"] = target_usd
        result["usd_rate"] = usd_rate
        result["potential_roi"] = ((target_tl - current_price) / current_price) * 100
        
        reasons.append(f"[Matematiksel Hedef]: Volatilite (ATR) hesaplamasına göre formasyon kâr alma seviyesi {target_tl:.2f} TL (veya {target_usd:.2f} Dolar) olarak belirlendi.")
        
        # Log to Journal if it's an approved buy signal
        if sniper_approved and quantum_approved and symbol != "":
            log_prediction(
                symbol=symbol,
                entry_price=current_price,
                target_price_tl=target_tl,
                target_price_usd=target_usd,
                usd_rate=usd_rate,
                confidence=prob_up,
                sniper_label=f"RF:{int(prob_up*100)}|LSTM:{int(lstm_prob*100) if lstm_prob else 0}"
            )
            
    return result

@app.post("/api/predict")
def predict_symbol(req: PredictionRequest):
    symbol = req.symbol.upper()
    try:
        raw_result = predict_rf(symbol)
        result = _process_prediction(raw_result, symbol)
        return {"status": "success", "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

SCAN_ALL_MAX_WORKERS = 10

def _scan_one(sym: str):
    """Never swallows a failure as 'no signal' -- returns (error, result) so the
    caller can tell 'model/data error for this symbol' apart from 'scanned fine,
    just not approved' instead of silently collapsing both into the same None."""
    try:
        raw_result = predict_rf(sym)
        result = _process_prediction(raw_result, sym)
        return None, (result if result["sniper_approved"] else None)
    except Exception as e:
        return str(e), None

@app.get("/api/scan_all")
def scan_all_symbols():
    # yfinance/HTTP calls are I/O-bound and release the GIL, so a thread pool
    # gives a real wall-clock speedup here without needing an async rewrite of
    # predict_rf/predict_lstm (which are also called individually by
    # /api/predict and /api/shap, so their sync contract stays as-is).
    approved_list = []
    errors = []
    with ThreadPoolExecutor(max_workers=SCAN_ALL_MAX_WORKERS) as pool:
        for sym, (error, result) in zip(BIST100_SYMBOLS, pool.map(_scan_one, BIST100_SYMBOLS)):
            if error is not None:
                errors.append({"symbol": sym, "error": error})
            elif result is not None:
                approved_list.append(result)

    # Güven skoruna göre büyükten küçüğe sırala
    approved_list.sort(key=lambda x: x["class_probabilities"].get("UP", 0), reverse=True)
    attempted = len(BIST100_SYMBOLS)
    scanned = attempted - len(errors)
    status = "error" if errors and scanned == 0 else ("partial" if errors else "success")
    return {
        "status": status,
        "count": len(approved_list),
        "data": approved_list,
        "attempted": attempted,
        "scanned": scanned,
        "errors": errors,
        "calculated_at": datetime.now(timezone.utc).isoformat(),
    }

def _sma_seeded_ema(close, length: int):
    """EMA seeded with the SMA of the first `length` closes (pandas_ta.ema's
    default), so values match what pandas_ta produced. pandas_ta itself can't
    be installed next to the locked numba/numpy."""
    seeded = close.copy()
    seeded.iloc[: length - 1] = np.nan
    if len(close) >= length:
        seeded.iloc[length - 1] = close.iloc[:length].mean()
    # Leading NaNs stay NaN; the recursion starts at the SMA seed.
    return seeded.ewm(span=length, adjust=False).mean()


@app.get("/api/chart/{symbol}")
def get_chart_data(symbol: str):
    import pandas as pd
    ticker = f"{symbol.upper()}.IS" if not symbol.endswith(".IS") else symbol.upper()
    try:
        df = yf.download(ticker, period="6mo", progress=False)
        if df.empty:
            raise HTTPException(status_code=404, detail="Data not found")
            
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.droplevel(1)
            
        close = df['Close'].astype(np.float64)
        df['sma50'] = close.rolling(50).mean()
        df['ema9'] = _sma_seeded_ema(close, 9)
        # Bollinger(5, 2σ, sample std) -- pandas_ta.bbands defaults.
        bb_mid = close.rolling(5).mean()
        bb_std = close.rolling(5).std(ddof=1)
        df['bb_lower'] = bb_mid - 2 * bb_std
        df['bb_upper'] = bb_mid + 2 * bb_std

        df.dropna(subset=['sma50'], inplace=True)
        
        chart_data = []
        for date, row in df.iterrows():
            chart_data.append({
                "time": date.strftime("%Y-%m-%d"),
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "close": float(row["Close"]),
                "sma50": float(row["sma50"]) if pd.notna(row.get("sma50")) else None,
                "ema9": float(row["ema9"]) if pd.notna(row.get("ema9")) else None,
                "bb_lower": float(row["bb_lower"]) if pd.notna(row.get("bb_lower")) else None,
                "bb_upper": float(row["bb_upper"]) if pd.notna(row.get("bb_upper")) else None,
            })
            
        return {"status": "success", "data": chart_data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/shap/{symbol}")
def get_shap_breakdown(symbol: str):
    """Detailed SHAP feature attribution breakdown for a symbol."""
    symbol = symbol.upper()
    try:
        raw_result = predict_rf(symbol)
        shap_data = _compute_shap_explanation(raw_result)
        if not shap_data:
            raise HTTPException(status_code=503, detail="SHAP explainer not available")
        return {"status": "success", "symbol": symbol, "data": shap_data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/sentiment/{symbol}")
def get_sentiment(symbol: str):
    """Get news sentiment analysis for a symbol."""
    symbol = symbol.upper()
    try:
        sentiment_data = _fetch_news_sentiment(symbol)
        return {"status": "success", "symbol": symbol, "data": sentiment_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/meta/weights")
def get_meta_weights():
    """Get current adaptive meta-learning weights."""
    return {"status": "success", "data": meta_engine.weights}

@app.post("/api/meta/calibrate")
def run_meta_calibration():
    """Trigger a meta-learning calibration cycle."""
    try:
        result = meta_engine.run_calibration()
        return {"status": "success", "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/history")
def get_daily_history(days: int = None):
    """
    Daily scan history: every symbol logged by run_daily_scan.py, with
    actual outcomes filled in once old enough to resolve. Resolves any
    newly-eligible pending rows on each call, so viewing this page also
    keeps it up to date without needing the scheduled script to have run
    since a prediction became resolvable.
    """
    try:
        resolve_pending_outcomes()
        return {"status": "success", "data": get_history(limit_days=days)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

app.include_router(signal_router)


if __name__ == "__main__":
    import uvicorn
    # Run the server locally on port 8000
    # Run from the repo root (parent of python_bot/) so the "python_bot." absolute
    # imports above resolve: `python -m python_bot.main_api`, or equivalently
    # `uvicorn python_bot.main_api:app --port 8001` from the repo root.
    uvicorn.run("python_bot.main_api:app", host="127.0.0.1", port=8001, reload=True)
