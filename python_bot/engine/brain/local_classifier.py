# -*- coding: utf-8 -*-
"""
Local, zero-cost ML decision engine.

Replaces `AdvancedQuantBot.evaluate_horizons()`'s hand-tuned, unjustified
point-weight blend (0.4 / 0.4 / 0.2 across three magic-number scoring
tables) with a real, locally-trained scikit-learn classifier.

Model choice: RandomForestClassifier over GradientBoostingClassifier or
XGBoost.
    - scikit-learn is already a project dependency; xgboost is not, and the
      brief asks to stay zero-cost/dependency-light, not to add a new
      heavyweight training library for a handful of BIST symbols.
    - RandomForest is far less sensitive to hyperparameters than boosting on
      a small, noisy sample (a few symbols x a few years of daily bars), so
      it is a safer default when we are not going to run a tuning sweep.
    - Training cost only matters for the "well under a minute" requirement,
      and RandomForest with a bounded n_estimators/max_depth on ~5 symbols
      of daily data trains in a couple of seconds -- boosting would not be
      meaningfully faster here, only more overfit-prone without tuning.

Feature set (deliberately small -- this is a lightweight signal, not a
research pipeline):
    - rsi_14                : 14-period RSI (momentum)
    - close_over_ema9       : close / EMA(9) - 1   (short-term trend)
    - close_over_sma50      : close / SMA(50) - 1  (medium-term trend)
    - volume_ratio          : volume / rolling 20d mean volume (participation)
    - regime_code           : numeric-encoded HMM market regime (0/1/2)
    - regime_confidence     : HMM posterior confidence in that regime

The regime features are produced by `engine.brain.regime_hmm.classify_regime_hmm`
(imported, not reimplemented) per the existing HMM module's own docstring:
it is the one part of the old scoring stack with an actual theoretical basis
(time-series-aware latent-state regime detection vs. i.i.d. clustering).

Note on regime features during *training*: `classify_regime_hmm` fits the
HMM on a symbol's full available return/volatility history and reports only
the *current* (most recent) regime -- it does not expose a full historical
state path, and re-fitting a fresh HMM at every single historical bar to get
a "regime as of that day" feature would defeat the "trains in well under a
minute" requirement for what is meant to be a lightweight pipeline. So for
training, each symbol's regime is computed once from its full history and
applied as a constant contextual feature across that symbol's training rows.
This is a deliberate simplification (documented here rather than hidden):
it gives the model a coarse "what kind of market has this symbol recently
been in" signal rather than a perfectly time-aligned per-bar regime label.
At prediction time this is a non-issue -- `predict()` computes the regime
once, for "as of today", which is exactly what's needed.

Label: forward-return direction over N=5 trading days (~1 trading week),
a horizon short enough to be evaluated frequently but long enough to smooth
out single-day noise. Thresholds of +/-2% split the forward return into
UP / DOWN / FLAT -- 2% is comfortably above typical single-day noise for
liquid BIST large caps, so FLAT genuinely means "no meaningful move", not
just "small move in either direction due to noise".
"""
import logging
import os
from pathlib import Path
from typing import Dict, Any, List, Optional

import numpy as np
import pandas as pd
import yfinance as yf
import joblib
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score

from engine.brain.regime_hmm import classify_regime_hmm

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("BIST_LocalClassifier")

MODEL_VERSION = "local_rf_v1"
FORWARD_HORIZON_DAYS = 5
UP_THRESHOLD = 0.02
DOWN_THRESHOLD = -0.02

FEATURE_COLUMNS: List[str] = [
    "rsi_14",
    "close_over_ema9",
    "close_over_sma50",
    "volume_ratio",
    "macd",
    "macd_hist",
    "macd_signal",
    "bb_bandwidth",
    "bb_percent",
    "atr_14",
    "regime_code",
    "regime_confidence",
]

REGIME_CODE_MAP = {"YATAY": 0, "TREND": 1, "KRİZ": 2}

MODELS_DIR = Path(__file__).resolve().parent.parent.parent / "models"
MODEL_PATH = MODELS_DIR / "local_classifier.joblib"


def _normalize_symbol(symbol: str) -> str:
    return symbol if symbol.endswith(".IS") else f"{symbol}.IS"


def _rsi(close: pd.Series, period: int = 14) -> pd.Series:
    import pandas_ta as ta
    return ta.rsi(close, length=period).fillna(50.0)


def _fetch_history(symbol: str, period: str = "3y") -> pd.DataFrame:
    ticker = _normalize_symbol(symbol)
    df = yf.download(ticker, period=period, progress=False)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.droplevel(1)
    return df


def _engineer_base_features(df: pd.DataFrame) -> pd.DataFrame:
    import pandas_ta as ta
    out = df.copy()
    out["rsi_14"] = _rsi(out["Close"], 14)
    ema9 = ta.ema(out["Close"], length=9)
    sma50 = ta.sma(out["Close"], length=50)
    out["close_over_ema9"] = (out["Close"] / ema9) - 1.0
    out["close_over_sma50"] = (out["Close"] / sma50) - 1.0
    vol_mean20 = ta.sma(out["Volume"], length=20)
    out["volume_ratio"] = out["Volume"] / vol_mean20.replace(0, np.nan)
    
    # MACD
    macd = ta.macd(out["Close"])
    if macd is not None and not macd.empty:
        out["macd"] = macd.iloc[:, 0]
        out["macd_hist"] = macd.iloc[:, 1]
        out["macd_signal"] = macd.iloc[:, 2]
    
    # Bollinger Bands
    bb = ta.bbands(out["Close"])
    if bb is not None and not bb.empty:
        out["bb_lower"] = bb.iloc[:, 0]
        out["bb_mid"] = bb.iloc[:, 1]
        out["bb_upper"] = bb.iloc[:, 2]
        out["bb_bandwidth"] = bb.iloc[:, 3]
        out["bb_percent"] = bb.iloc[:, 4]
        
    # ATR
    atr = ta.atr(out["High"], out["Low"], out["Close"])
    if atr is not None and not atr.empty:
        out["atr_14"] = atr
        
    return out


def _regime_features_for_symbol(close: pd.Series) -> Dict[str, float]:
    """
    Fits the HMM once on the full close series for this symbol and returns a
    constant (regime_code, regime_confidence) pair -- see module docstring
    for why this is computed once per symbol rather than per bar.
    """
    try:
        result = classify_regime_hmm(close, n_states=3)
        code = REGIME_CODE_MAP.get(result["regime"], 0)
        return {"regime_code": float(code), "regime_confidence": float(result["confidence"])}
    except Exception as e:
        logger.warning(f"HMM regime fit failed, defaulting to neutral regime: {e}")
        return {"regime_code": 0.0, "regime_confidence": 0.0}


def _build_training_rows(symbol: str) -> Optional[pd.DataFrame]:
    df = _fetch_history(symbol, period="3y")
    if df.empty or len(df) < 120:
        logger.warning(f"Not enough history for {symbol}, skipping.")
        return None

    feat = _engineer_base_features(df)

    regime = _regime_features_for_symbol(df["Close"])
    feat["regime_code"] = regime["regime_code"]
    feat["regime_confidence"] = regime["regime_confidence"]

    # Forward N-day return -> UP / DOWN / FLAT label
    fwd_return = feat["Close"].shift(-FORWARD_HORIZON_DAYS) / feat["Close"] - 1.0
    label = pd.Series(np.where(fwd_return > UP_THRESHOLD, "UP",
                       np.where(fwd_return < DOWN_THRESHOLD, "DOWN", "FLAT")),
                       index=feat.index)
    feat["label"] = label
    feat["symbol"] = symbol

    feat = feat.dropna(subset=FEATURE_COLUMNS)
    # Drop the tail rows where the forward-looking label is undefined
    feat = feat.iloc[:-FORWARD_HORIZON_DAYS] if len(feat) > FORWARD_HORIZON_DAYS else feat.iloc[0:0]

    return feat[FEATURE_COLUMNS + ["label", "symbol"]]


def train_and_save(symbols: List[str]) -> None:
    """
    Fetches history for `symbols` via yfinance, engineers features, labels
    each row by forward 5-day return direction, fits a RandomForestClassifier
    and saves it (plus feature/label metadata) to models/local_classifier.joblib.
    """
    logger.info(f"Training local classifier on {len(symbols)} symbols: {symbols}")
    frames = []
    for symbol in symbols:
        try:
            rows = _build_training_rows(symbol)
            if rows is not None and not rows.empty:
                frames.append(rows)
        except Exception as e:
            logger.error(f"Failed to build training rows for {symbol}: {e}")

    if not frames:
        raise RuntimeError("No training data could be built for any symbol.")

    data = pd.concat(frames, axis=0, ignore_index=True)
    logger.info(f"Assembled {len(data)} training rows across {len(frames)} symbols.")
    logger.info(f"Label distribution:\n{data['label'].value_counts()}")

    X = data[FEATURE_COLUMNS].astype(float).to_numpy()
    y = data["label"].astype(str).to_numpy()

    if len(np.unique(y)) < 2:
        raise RuntimeError("Training data collapsed to a single class; cannot fit a classifier.")

    stratify = y if min(pd.Series(y).value_counts()) >= 2 else None
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.25, random_state=42, stratify=stratify
    )

    model = RandomForestClassifier(
        n_estimators=200,
        max_depth=6,
        min_samples_leaf=10,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)

    test_acc = accuracy_score(y_test, model.predict(X_test))
    logger.info(f"Holdout accuracy: {test_acc:.3f} (naive baseline would be ~{1/len(np.unique(y)):.3f} for {len(np.unique(y))} balanced classes)")

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "model": model,
        "feature_columns": FEATURE_COLUMNS,
        "model_version": MODEL_VERSION,
        "forward_horizon_days": FORWARD_HORIZON_DAYS,
        "trained_on_symbols": symbols,
        "holdout_accuracy": float(test_acc),
    }
    joblib.dump(payload, MODEL_PATH)
    logger.info(f"Saved model to {MODEL_PATH}")


def predict(symbol: str) -> Dict[str, Any]:
    """
    Loads the saved model and returns a prediction for `symbol` "as of today"
    (the latest available daily bar from yfinance).
    """
    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"No trained model found at {MODEL_PATH}. Run train_and_save(symbols) first."
        )

    payload = joblib.load(MODEL_PATH)
    model = payload["model"]
    feature_columns = payload["feature_columns"]

    df = _fetch_history(symbol, period="1y")
    if df.empty or len(df) < 60:
        raise ValueError(f"Not enough recent history for {symbol} to compute features.")

    feat = _engineer_base_features(df)
    regime = _regime_features_for_symbol(df["Close"])
    feat["regime_code"] = regime["regime_code"]
    feat["regime_confidence"] = regime["regime_confidence"]

    latest = feat.dropna(subset=feature_columns).iloc[-1]
    x = latest[feature_columns].values.reshape(1, -1)

    proba = model.predict_proba(x)[0]
    classes = model.classes_
    predicted_idx = int(np.argmax(proba))
    predicted_label = str(classes[predicted_idx])
    probability = float(proba[predicted_idx])

    as_of = latest.name
    as_of_str = as_of.strftime("%Y-%m-%d") if hasattr(as_of, "strftime") else str(as_of)

    return {
        "symbol": symbol,
        "as_of": as_of_str,
        "predicted_label": predicted_label,
        "probability": probability,
        "model_version": payload.get("model_version", MODEL_VERSION),
        "regime_confidence": regime["regime_confidence"],
        "current_price": float(latest["Close"]),
        "class_probabilities": {str(c): float(p) for c, p in zip(classes, proba)},
        "features": {col: float(latest[col]) for col in feature_columns},
    }


if __name__ == "__main__":
    demo_symbols = ["THYAO", "GARAN", "AKBNK", "TUPRS", "ASELS"]
    train_and_save(demo_symbols)
    print(predict("THYAO"))
