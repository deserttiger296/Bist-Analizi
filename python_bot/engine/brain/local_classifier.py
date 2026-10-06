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
HMM on whatever series it's given and reports only the *current* (most
recent) regime. An earlier version of this pipeline called it once on each
symbol's full 3-year history and broadcast that single value as a constant
across every training row -- which is look-ahead leakage (a row from 3 years
ago would be labeled with a regime informed by prices 3 years in its
future), not just a coarse approximation. `_rolling_regime_features` fixes
this: it refits every REGIME_REFIT_EVERY bars on an *expanding* window that
never extends past that row, and forward-fills between refits. Refitting on
every single bar would be the theoretically purest version but would defeat
the "trains in well under a minute" requirement; periodic refitting is the
practical middle ground while staying strictly backward-looking. At
prediction time this is a non-issue -- `predict()` computes the regime once,
for "as of today", which is exactly what's needed and involves no future
data by construction.

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
from sklearn.metrics import accuracy_score

from python_bot.engine.brain.regime_hmm import classify_regime_hmm

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("BIST_LocalClassifier")

MODEL_VERSION = "local_rf_v2"
FEATURE_SCHEMA_VERSION = "ohlcv-relative-hmm-v2"
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
    "rel_return_5d",
    "rel_return_20d",
]

REGIME_CODE_MAP = {"YATAY": 0, "TREND": 1, "KRİZ": 2}

BENCHMARK_TICKER = "XU100.IS"

# How many ATR-implied-volatility units of forward move counts as a genuine
# UP/DOWN call vs. FLAT (see `_label_forward_return` for why this replaced a
# flat +/-2% threshold). Tunable; not backtested/optimized yet -- a starting
# point, not a calibrated constant.
ATR_LABEL_MULTIPLIER = 0.5

MODELS_DIR = Path(__file__).resolve().parent.parent.parent / "models"
MODEL_PATH = MODELS_DIR / "local_classifier.joblib"


def _normalize_symbol(symbol: str) -> str:
    return symbol if symbol.endswith(".IS") else f"{symbol}.IS"


def _rsi(close: pd.Series, period: int = 14) -> pd.Series:
    from python_bot.engine.signals.rsi_pu30 import wilder_rsi
    return pd.Series(wilder_rsi(close.to_numpy(dtype=np.float64), period), index=close.index)


def _fetch_history(symbol: str, period: str = "3y") -> pd.DataFrame:
    ticker = _normalize_symbol(symbol)
    df = yf.download(ticker, period=period, progress=False, auto_adjust=True, timeout=15)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.droplevel(1)
    from python_bot.engine.data.provider import is_bar_closed
    # yfinance sometimes returns the latest day with NaN OHLC (volume filled) before the
    # bar is finalised; such a row would poison every rolling feature of the last row.
    df = df.dropna(subset=["Open", "High", "Low", "Close"])
    return df.loc[[is_bar_closed(t, "1d") for t in df.index]]


def _fetch_benchmark_close(period: str = "3y") -> pd.Series:
    """Fetch the XU100 index close series used for relative-momentum features."""
    df = yf.download(BENCHMARK_TICKER, period=period, progress=False, auto_adjust=True, timeout=15)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.droplevel(1)
    return df["Close"].dropna()


def _relative_momentum_features(close: pd.Series, benchmark_close: pd.Series) -> pd.DataFrame:
    """
    Cross-sectional features: this stock's N-day return minus the XU100
    index's N-day return over the same window ("is this stock beating the
    market, not just moving"). Single-stock technicals (RSI, MACD, etc.) are
    usually weak signal on their own in a reasonably efficient market --
    relative/cross-sectional strength tends to carry more information than
    absolute technicals.

    `benchmark_close` is reindexed onto `close`'s dates with forward-fill,
    since the two tickers' trading calendars can differ by a handful of
    holidays -- this only ever fills from the benchmark's own past, so it
    does not introduce any forward-looking information.
    """
    bench_aligned = benchmark_close.reindex(close.index).ffill()

    stock_ret_5d = close.pct_change(5)
    stock_ret_20d = close.pct_change(20)
    bench_ret_5d = bench_aligned.pct_change(5)
    bench_ret_20d = bench_aligned.pct_change(20)

    return pd.DataFrame({
        "rel_return_5d": stock_ret_5d - bench_ret_5d,
        "rel_return_20d": stock_ret_20d - bench_ret_20d,
    }, index=close.index)


def _engineer_base_features(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy().astype(np.float64)
    c = out["Close"]
    out["rsi_14"] = _rsi(c)
    out["close_over_ema9"] = c/c.ewm(span=9, adjust=False, min_periods=9).mean()-1
    out["close_over_sma50"] = c/c.rolling(50).mean()-1
    out["volume_ratio"] = out.Volume/out.Volume.rolling(20).mean().replace(0, np.nan)
    out["macd"] = c.ewm(span=12, adjust=False).mean()-c.ewm(span=26, adjust=False).mean()
    out["macd_signal"] = out.macd.ewm(span=9, adjust=False).mean()
    out["macd_hist"] = out.macd-out.macd_signal
    mid, std = c.rolling(20).mean(), c.rolling(20).std(ddof=0)
    out["bb_bandwidth"] = 400*std/mid
    out["bb_percent"] = (c-(mid-2*std))/(4*std).replace(0,np.nan)
    tr = pd.concat([out.High-out.Low,(out.High-c.shift()).abs(),(out.Low-c.shift()).abs()],axis=1).max(axis=1)
    out["atr_14"] = tr.ewm(alpha=1/14, adjust=False, min_periods=14).mean()
    return out


def build_features(df, benchmark_close):
    """Single causal feature path for RF and LSTM, both training and inference."""
    out = _engineer_base_features(df)
    out = out.join(_rolling_regime_features(df.Close))
    out = out.join(_relative_momentum_features(df.Close, benchmark_close))
    return out.replace([np.inf, -np.inf], np.nan)


def validate_artifact(payload):
    if payload.get("feature_schema_version") != FEATURE_SCHEMA_VERSION or payload.get("feature_columns") != FEATURE_COLUMNS:
        raise ValueError("MODEL_INCOMPATIBLE: feature schema/order mismatch; retraining required")
    for key in ("training_start", "training_end", "selection_end", "label_definition", "forward_horizon_days", "preprocessing_version", "validation_method", "validation_results", "model_version"):
        if key not in payload:
            raise ValueError(f"MODEL_INCOMPATIBLE: missing {key}")
    if payload["forward_horizon_days"] != FORWARD_HORIZON_DAYS or payload["preprocessing_version"] != FEATURE_SCHEMA_VERSION or payload["label_definition"] != "UP/DOWN/FLAT: +/-0.5*ATR/close*sqrt(5), 5 trading bars":
        raise ValueError("MODEL_INCOMPATIBLE: target or preprocessing mismatch")


def artifact_metadata(train, selection, model_version, results):
    return {"feature_schema_version": FEATURE_SCHEMA_VERSION, "feature_columns": FEATURE_COLUMNS,
            "training_start": str(train.index.min()), "training_end": str(train.index.max()),
            "selection_end": str(selection.index.max()), "model_version": model_version,
            "forward_horizon_days": FORWARD_HORIZON_DAYS,
            "label_definition": "UP/DOWN/FLAT: +/-0.5*ATR/close*sqrt(5), 5 trading bars",
            "preprocessing_version": FEATURE_SCHEMA_VERSION,
            "validation_method": "shared-date-purged-holdout", "validation_results": results}


def _regime_features_for_symbol(close: pd.Series) -> Dict[str, float]:
    """
    Fits the HMM on the full close series and returns the *current* (most
    recent) regime as of the last bar. Used at prediction time, where "the
    full series" genuinely means "everything available as of today" -- there
    is no future to leak. Do NOT use this for training-row features (see
    `_rolling_regime_features` for why).
    """
    try:
        result = classify_regime_hmm(close, n_states=3)
        code = REGIME_CODE_MAP.get(result["regime"], 0)
        return {"regime_code": float(code), "regime_confidence": float(result["confidence"])}
    except Exception as e:
        logger.warning(f"HMM regime fit failed, defaulting to neutral regime: {e}")
        raise RuntimeError("HMM_UNAVAILABLE") from e


REGIME_MIN_HISTORY = 150
REGIME_REFIT_EVERY = 20


def _rolling_regime_features(close: pd.Series) -> pd.DataFrame:
    """
    Time-safe regime features for training rows.

    `_regime_features_for_symbol` fits on the whole series handed to it and
    reports only the *last* bar's regime -- fine for live prediction ("as of
    today"), but if you call it once on a symbol's full 3-year history and
    broadcast that single value across every training row, a row from 3
    years ago ends up labeled with a regime that was computed using prices
    from 3 years in its future. That is look-ahead leakage, not just a
    coarse approximation.

    This instead refits the HMM every REGIME_REFIT_EVERY bars using only an
    *expanding* window up to and including that point (never beyond it), and
    forward-fills the classification until the next refit. Refitting every
    single bar would be the theoretically cleanest version but is far too
    slow for a "trains in well under a minute" pipeline; refitting
    periodically is the practical middle ground -- still strictly
    backward-looking, just piecewise-constant between refits instead of
    updated daily.
    """
    n = len(close)
    codes = pd.Series(np.nan, index=close.index)
    confidences = pd.Series(np.nan, index=close.index)

    i = REGIME_MIN_HISTORY
    while i < n:
        window = close.iloc[: i + 1]
        try:
            result = classify_regime_hmm(window, n_states=3)
            code = float(REGIME_CODE_MAP.get(result["regime"], 0))
            conf = float(result["confidence"])
        except Exception as e:
            logger.warning(f"Rolling HMM regime fit failed at row {i}, defaulting to neutral: {e}")
            raise RuntimeError("HMM_UNAVAILABLE") from e
        end = min(i + REGIME_REFIT_EVERY, n)
        codes.iloc[i:end] = code
        confidences.iloc[i:end] = conf
        i += REGIME_REFIT_EVERY

    return pd.DataFrame({"regime_code": codes, "regime_confidence": confidences}, index=close.index)


def _label_forward_return(feat: pd.DataFrame) -> pd.Series:
    """
    UP / DOWN / FLAT label from the forward FORWARD_HORIZON_DAYS return,
    judged against a threshold scaled by the symbol's OWN recent volatility
    (ATR as a fraction of price) rather than a flat +/-2% for every stock.

    A flat threshold means a quiet bank stock and a volatile small-cap need
    the same size move to count as "UP" -- so FLAT ends up overrepresented
    for calm stocks and underrepresented for volatile ones, and the model
    partly just learns "which stock is this" instead of "did it move".
    Scaling the bar by ATR_14 (already a legitimate, backward-looking
    feature known at prediction time -- see FEATURE_COLUMNS) makes the label
    threshold adapt per symbol without using any future information.
    """
    atr_pct = (feat["atr_14"] / feat["Close"]).clip(lower=1e-6)
    vol_threshold = ATR_LABEL_MULTIPLIER * atr_pct * np.sqrt(FORWARD_HORIZON_DAYS)

    fwd_return = feat["Close"].shift(-FORWARD_HORIZON_DAYS) / feat["Close"] - 1.0
    labels = pd.Series(
        np.where(fwd_return > vol_threshold, "UP",
                 np.where(fwd_return < -vol_threshold, "DOWN", "FLAT")),
        index=feat.index,
    )
    return labels.where(fwd_return.notna())


def _build_training_rows(symbol: str, benchmark_close: Optional[pd.Series] = None) -> Optional[pd.DataFrame]:
    df = _fetch_history(symbol, period="3y")
    if df.empty or len(df) < 120:
        logger.warning(f"Not enough history for {symbol}, skipping.")
        return None

    if benchmark_close is None:
        benchmark_close = _fetch_benchmark_close(period="3y")
    feat = build_features(df, benchmark_close)
    feat["label"] = _label_forward_return(feat)
    feat["label_end"] = pd.Series(df.index, index=df.index).shift(-FORWARD_HORIZON_DAYS)
    feat["symbol"] = symbol
    return feat.dropna(subset=FEATURE_COLUMNS+["label", "label_end"])[FEATURE_COLUMNS+["label", "symbol", "label_end"]]


WALKFORWARD_TRAIN_FRACTION = 0.75


def _walkforward_split(rows: pd.DataFrame) -> "tuple[pd.DataFrame, pd.DataFrame]":
    """
    Chronological train/test split for one symbol's (already time-ordered)
    feature rows: the first WALKFORWARD_TRAIN_FRACTION of rows are train, the
    rest are test, with a FORWARD_HORIZON_DAYS purge gap dropped between them.

    A plain `sklearn.train_test_split` shuffles rows randomly, which for daily
    bars with a 5-day forward-return label leaks adjacent, autocorrelated days
    across the train/test boundary and inflates the reported accuracy -- this
    project's own CLAUDE.md requires walk-forward validation for time series,
    which is what this purged, chronological split provides instead. The
    purge gap additionally prevents a training row's forward-return label
    from being computed using prices that fall inside the test window.
    """
    n = len(rows)
    split_idx = int(n * WALKFORWARD_TRAIN_FRACTION)
    train_end = max(split_idx - FORWARD_HORIZON_DAYS, 0)
    return rows.iloc[:train_end], rows.iloc[split_idx:]


def build_training_set(symbols: List[str], benchmark_close: pd.Series):
    """Rows for all symbols whose features could be computed. A symbol whose
    features fail (e.g. HMM_UNAVAILABLE) is excluded and reported -- never
    filled with a made-up neutral value."""
    frames, skipped = [], {}
    for symbol in symbols:
        try:
            rows = _build_training_rows(symbol, benchmark_close)
            if rows is None or rows.empty:
                skipped[symbol] = "insufficient history"
            else:
                frames.append(rows)
        except Exception as e:
            skipped[symbol] = str(e)
            logger.warning(f"Skipping {symbol}: {e}")
    if not frames:
        raise RuntimeError(f"No training data could be built; skipped: {skipped}")
    return pd.concat(frames).sort_index(), skipped


def train_and_save(symbols: List[str]) -> None:
    """
    Fetches history for `symbols` via yfinance, engineers features, labels
    each row by forward 5-day return direction, fits a RandomForestClassifier
    and saves it (plus feature/label metadata) to models/local_classifier.joblib.
    """
    logger.info(f"Training local classifier on {len(symbols)} symbols: {symbols}")
    benchmark_close = _fetch_benchmark_close(period="3y")  # fetch once, shared across all symbols
    rows, skipped = build_training_set(symbols, benchmark_close)
    from python_bot.engine.brain.validation import split_by_date
    train_data, test_data, final_data = split_by_date(rows)
    logger.info(f"Assembled {len(train_data)} training rows across {len(symbols)} requested symbols "
                f"({train_data['symbol'].nunique()} with usable history).")
    logger.info(f"Label distribution:\n{train_data['label'].value_counts()}")

    X_train = train_data[FEATURE_COLUMNS].astype(float).to_numpy()
    y_train = train_data["label"].astype(str).to_numpy()

    if len(np.unique(y_train)) < 2:
        raise RuntimeError("Training data collapsed to a single class; cannot fit a classifier.")

    model = RandomForestClassifier(
        n_estimators=200,
        max_depth=6,
        min_samples_leaf=10,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)

    if not test_data.empty:
        X_test = test_data[FEATURE_COLUMNS].astype(float).to_numpy()
        y_test = test_data["label"].astype(str).to_numpy()
        test_acc = float(accuracy_score(y_test, model.predict(X_test)))
        n_classes = len(np.unique(y_train))
        logger.info(f"Walk-forward holdout accuracy: {test_acc:.3f} on {len(test_data)} rows (naive baseline would be ~{1/n_classes:.3f} for {n_classes} balanced classes)")

        # Raw multiclass accuracy across ALL rows doesn't tell you whether the
        # model's high-confidence calls are trustworthy -- and the "AL"
        # signal in main_api.py only fires when P(UP) clears a threshold
        # (0.60 by default, see engine/brain/meta_learning.py). So also
        # report precision specifically among rows that would have cleared
        # that threshold: this is the number that actually matters for a
        # real buy decision, not the average over every row including ones
        # the system would never have acted on.
        up_idx = list(model.classes_).index("UP") if "UP" in model.classes_ else None
        threshold_precision = {}
        if up_idx is not None:
            proba_up = model.predict_proba(X_test)[:, up_idx]
            for threshold in (0.5, 0.6, 0.7):
                mask = proba_up >= threshold
                support = int(mask.sum())
                if support > 0:
                    precision = float((y_test[mask] == "UP").mean())
                else:
                    precision = None
                threshold_precision[threshold] = {"precision": precision, "support": support}
                logger.info(f"  P(UP)>={threshold}: precision={precision if precision is None else f'{precision:.3f}'}, support={support}")
    else:
        test_acc = None
        threshold_precision = {}
        logger.warning("No walk-forward test rows available (symbol history too short); holdout_accuracy is unset.")

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "model": model,
        "feature_columns": FEATURE_COLUMNS,
        "model_version": MODEL_VERSION,
        "forward_horizon_days": FORWARD_HORIZON_DAYS,
        "trained_on_symbols": symbols,
        "holdout_accuracy": test_acc,
        "validation_method": "walk_forward_purged",
        "up_precision_by_threshold": threshold_precision,
    }
    payload.update(artifact_metadata(train_data, test_data, MODEL_VERSION, {"selection_accuracy": test_acc, "untouched_final_rows": len(final_data)}))
    payload["symbols"] = sorted(rows["symbol"].unique().tolist())
    payload["skipped_symbols"] = skipped
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
    validate_artifact(payload)
    model = payload["model"]
    feature_columns = payload["feature_columns"]

    df = _fetch_history(symbol, period="1y")
    if df.empty or len(df) < 60:
        raise ValueError(f"Not enough recent history for {symbol} to compute features.")

    feat = build_features(df, _fetch_benchmark_close(period="1y"))
    latest = feat.iloc[-1]
    if latest[feature_columns].isna().any():
        raise ValueError("DATA_INSUFFICIENT: latest feature row is incomplete")
    regime = latest
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
        "source": "yfinance_auto_adjust",
        "score_semantics": "uncalibrated_class_score",
        "calculated_at": pd.Timestamp.now(tz="UTC").isoformat(),
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
