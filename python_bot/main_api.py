import os
import sys
import time
import json
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from engine.brain.local_classifier import predict as predict_rf
from engine.brain.deep_model import predict_lstm
from engine.brain.logger import log_prediction
from engine.brain.finbert_sentiment import FinBertSentimentAnalyzer
from engine.brain.meta_learning import MetaLearningCalibrationEngine
import yfinance as yf
import numpy as np

# --- SHAP (optional, graceful fallback) ---
_shap_explainer = None
_shap_available = False
try:
    import shap
    import joblib
    from engine.brain.local_classifier import MODEL_PATH, FEATURE_COLUMNS
    _shap_available = True
except ImportError:
    shap = None
    print("[SHAP] shap package not installed. XAI will use rule-based fallback.")

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
    global _shap_explainer
    if _shap_available and _shap_explainer is None:
        try:
            if MODEL_PATH.exists():
                payload = joblib.load(MODEL_PATH)
                model = payload["model"]
                _shap_explainer = shap.TreeExplainer(model)
                print("[SHAP] TreeExplainer initialized successfully.")
        except Exception as e:
            print(f"[SHAP] Failed to init explainer: {e}")


class PredictionRequest(BaseModel):
    symbol: str

@app.get("/")
def root():
    return FileResponse(str(_PYTHON_BOT_ROOT / "static" / "index.html"))

BIST100_SYMBOLS = [
    "AGHOL", "AKBNK", "AKCNS", "AKFGY", "AKSA", "AKSEN", "ALARK", "ALBRK", "ALFAS", "ARCLK",
    "ASELS", "ASTOR", "ASUZU", "AYDEM", "BAGFS", "BERA", "BIMAS", "BRISA", "BRSAN", "BUCIM",
    "CANTE", "CCOLA", "CEMAS", "CIMSA", "CWCME", "DOAS", "DOHOL", "ECILC", "EGEEN", "EKGYO",
    "ENJSA", "ENKAI", "ERBOS", "EREGL", "EUREN", "EUPWR", "FROTO", "GARAN", "GENIL", "GESAN",
    "GLYHO", "GUBRF", "GWIND", "HALKB", "HEKTS", "HLGYO", "IPEKE", "ISCTR", "ISDMR", "ISGYO",
    "ISMEN", "IZMDC", "KARSN", "KCAER", "KCHOL", "KMPUR", "KONTR", "KONYA", "KORDS", "KOZAA",
    "KOZAL", "KRDMD", "KZBGY", "MAVI", "MGROS", "MIATK", "ODAS", "OTKAR", "OYAKC", "PENTA",
    "PETKM", "PGSUS", "PSGYO", "QUAGR", "SAHOL", "SASA", "SELEC", "SISE", "SMRTG", "SNGYO",
    "SOKM", "TABGD", "TAVHL", "TCELL", "THYAO", "TKFEN", "TOASO", "TSKB", "TTKOM", "TTRAK",
    "TUKAS", "TUPRS", "ULKER", "VAKBN", "VESBE", "VESTL", "YEOTK", "YKBNK", "YYLGD", "ZOREN"
]

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
        classes = list(_shap_explainer.model.classes_)
        up_idx = classes.index("UP") if "UP" in classes else 0

        if isinstance(shap_values, list):
            sv = shap_values[up_idx][0]  # shape: (n_features,)
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
        sniper_label = "AL (GÜÇLÜ YÜKSELİŞ)"
        sniper_approved = True
    else:
        sniper_label = "İZLE (RİSKLİ/YATAY)"
        sniper_approved = False
        
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
    
    if sniper_approved and symbol != "":
        try:
            lstm_prob = predict_lstm(symbol)
            if lstm_prob is not None:
                result["lstm_probability"] = lstm_prob
                if lstm_prob > lstm_threshold:
                    quantum_approved = True
                    reasons.append(f"[KUANTUM ONAYI - LSTM %{int(lstm_prob*100)}]: Derin Öğrenme (Hafıza) modeli de YÜKSELİŞ öngörüsünü doğruladı! Çapraz Kontrol Başarılı.")
                else:
                    reasons.append(f"[DİKKAT - LSTM %{int(lstm_prob*100)}]: Derin Öğrenme (Hafıza) bu işleme şüpheli yaklaşıyor. Çapraz onay alınamadı.")
        except Exception as e:
            print(f"LSTM Error for {symbol}: {e}")

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

@app.get("/api/scan_all")
def scan_all_symbols():
    approved_list = []
    
    for sym in BIST100_SYMBOLS:
        try:
            raw_result = predict_rf(sym)
            result = _process_prediction(raw_result, sym)
            
            # Sadece Sniper Onayı Alanları Filtrele
            if result["sniper_approved"]:
                approved_list.append(result)
        except Exception as e:
            print(f"Skipping {sym}: {e}")
            continue
            
    # Güven skoruna göre büyükten küçüğe sırala
    approved_list.sort(key=lambda x: x["class_probabilities"].get("UP", 0), reverse=True)
    return {"status": "success", "count": len(approved_list), "data": approved_list}

@app.get("/api/chart/{symbol}")
def get_chart_data(symbol: str):
    import pandas as pd
    import pandas_ta as ta
    ticker = f"{symbol.upper()}.IS" if not symbol.endswith(".IS") else symbol.upper()
    try:
        df = yf.download(ticker, period="6mo", progress=False)
        if df.empty:
            raise HTTPException(status_code=404, detail="Data not found")
            
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.droplevel(1)
            
        df['sma50'] = ta.sma(df['Close'], length=50)
        df['ema9'] = ta.ema(df['Close'], length=9)
        bb = ta.bbands(df['Close'])
        if bb is not None and not bb.empty:
            df['bb_lower'] = bb.iloc[:, 0]
            df['bb_upper'] = bb.iloc[:, 2]
            
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

if __name__ == "__main__":
    import uvicorn
    # Run the server locally on port 8000
    uvicorn.run("main_api:app", host="127.0.0.1", port=8000, reload=True)
