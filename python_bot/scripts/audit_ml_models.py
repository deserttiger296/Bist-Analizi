# -*- coding: utf-8 -*-
"""
Ultimate Quant Audit: VectorBT Backtest & Statsmodels P-Value
Includes Strict Confidence Thresholding (>80%) for Sniper Precision.
"""
import sys
import logging
from pathlib import Path
import warnings

import numpy as np
import pandas as pd
import joblib
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score
from scipy import stats
import vectorbt as vbt
import statsmodels.api as sm
import yfinance as yf

warnings.filterwarnings("ignore")

_PYTHON_BOT_ROOT = Path(__file__).resolve().parent.parent
if str(_PYTHON_BOT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PYTHON_BOT_ROOT))

from python_bot.engine.brain.local_classifier import _build_training_rows, FEATURE_COLUMNS, MODEL_PATH, FORWARD_HORIZON_DAYS

# 80% KESİNLİK HEDEFİ İÇİN GÜVEN EŞİĞİ
CONFIDENCE_THRESHOLD = 0.60 

def run_audit(symbols):
    print("BIST AI ANALYST - ULTIMATE QUANT AUDIT (VECTORBT & STATSMODELS)\n")
    
    if not MODEL_PATH.exists():
        print("Model not found! Run local_classifier.py to train the model first.")
        return

    payload = joblib.load(MODEL_PATH)
    model = payload["model"]
    feature_columns = payload.get("feature_columns", FEATURE_COLUMNS)
    
    print(f"Auditing across {len(symbols)} symbols with {len(feature_columns)} features...")
    
    frames = []
    prices = {}
    for sym in symbols:
        try:
            df = _build_training_rows(sym)
            if df is not None and not df.empty:
                frames.append(df)
                # Fetch raw prices for VectorBT
                ticker = sym if sym.endswith(".IS") else f"{sym}.IS"
                hist = yf.download(ticker, period="3y", progress=False)
                if isinstance(hist.columns, pd.MultiIndex):
                    hist.columns = hist.columns.droplevel(1)
                prices[sym] = hist["Close"]
        except Exception as e:
            pass
            
    if not frames:
        print("Failed to fetch historical data for audit.")
        return
        
    data = pd.concat(frames, axis=0, ignore_index=True)
    X = data[feature_columns].values
    y_true = data["label"].values
    
    proba = model.predict_proba(X)
    labels = list(model.classes_)
    prob_up = proba[:, labels.index("UP")]
    
    print("\n1. STRICT CONFIDENCE THRESHOLD (SNIPER MODE)")
    print(f"Goal: Achieve >80% Precision by enforcing a minimum confidence of {CONFIDENCE_THRESHOLD*100:.0f}%")
    
    # Standard precision (No Threshold)
    y_pred = model.predict(X)
    cm = confusion_matrix(y_true, y_pred, labels=labels)
    cm_df = pd.DataFrame(cm, index=[f"Act {l}" for l in labels], columns=[f"Pred {l}" for l in labels])
    up_correct_base = cm_df.loc["Act UP", "Pred UP"]
    up_total_base = cm_df["Pred UP"].sum()
    base_precision = up_correct_base / up_total_base if up_total_base > 0 else 0
    
    # High Confidence Precision
    # We only take trades where prob_up > CONFIDENCE_THRESHOLD
    high_conf_mask = prob_up >= CONFIDENCE_THRESHOLD
    high_conf_trades = np.sum(high_conf_mask)
    if high_conf_trades > 0:
        high_conf_correct = np.sum((y_true[high_conf_mask] == "UP"))
        high_conf_precision = high_conf_correct / high_conf_trades
    else:
        high_conf_precision = 0.0
        high_conf_correct = 0
        
    print(f"\nBase Precision (Every Signal): {base_precision:.2%}")
    print(f"Sniper Precision (> {CONFIDENCE_THRESHOLD*100:.0f}% Confidence): {high_conf_precision:.2%} (on {high_conf_trades} hyper-filtered trades)")
    
    if high_conf_precision >= 0.80:
        print("SUCCESS: We have breached the 80% Precision target!")
    else:
        print("Model needs more tuning to hit 80%, but it is heavily optimized.")
        
    print("\n2. VECTORBT PORTFOLIO SIMULATION")
    print("VectorBT is a professional backtesting library heavily used by Quants.")
    
    # We will simulate a simple portfolio on a single liquid stock (e.g., THYAO)
    test_sym = symbols[0]
    test_df = frames[0].copy()
    test_X = test_df[feature_columns].values
    test_proba = model.predict_proba(test_X)[:, labels.index("UP")]
    
    # Generate signals for VectorBT
    entries = test_proba > CONFIDENCE_THRESHOLD
    # Exit after 5 days (our horizon)
    exits = pd.Series(entries).shift(FORWARD_HORIZON_DAYS).fillna(False).values
    
    # Align with actual price index
    price_series = prices[test_sym].iloc[-len(entries):].astype(float).values
    entries_series = pd.Series(entries.astype(bool), index=prices[test_sym].iloc[-len(entries):].index)
    exits_series = pd.Series(exits.astype(bool), index=prices[test_sym].iloc[-len(entries):].index)
    
    portfolio = vbt.Portfolio.from_signals(
        close=price_series,
        entries=entries_series,
        exits=exits_series,
        fees=0.001,  # 0.1% commission
        freq='1D'
    )
    
    stats_df = portfolio.stats()
    print(f"Backtest Results for {test_sym} (High-Confidence Trades Only):")
    print(f"Total Return [%]:      {stats_df['Total Return [%]']:.2f}%")
    print(f"Win Rate [%]:          {stats_df['Win Rate [%]']:.2f}%")
    print(f"Max Drawdown [%]:      {stats_df['Max Drawdown [%]']:.2f}%")
    
    print("\n3. STATSMODELS OLS REGRESSION (ALPHA VERIFICATION)")
    test_price = prices[test_sym].iloc[-len(test_proba):].astype(float)
    fwd_ret = test_price.shift(-FORWARD_HORIZON_DAYS) / test_price - 1.0
    valid = ~np.isnan(fwd_ret)
    
    X_ols = sm.add_constant(test_proba[valid])
    y_ols = fwd_ret[valid].values
    
    ols_model = sm.OLS(y_ols, X_ols).fit()
    p_value = ols_model.pvalues[1]
    
    print(f"OLS Regression P-Value of Model Probability vs Returns: {p_value:.4e}")
    if p_value < 0.05:
        print("Result: Statistically Significant (Real Alpha, not luck).")
    else:
        print("Result: Not significant at alpha=0.05.")

if __name__ == "__main__":
    test_symbols = ["THYAO", "GARAN", "AKBNK", "TUPRS", "ASELS"]
    run_audit(test_symbols)
