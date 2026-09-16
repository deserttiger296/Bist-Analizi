# -*- coding: utf-8 -*-
"""
Statistical Arbitrage: Pairs-Trading Cointegration Tests

Ported from src/tools/stat_engine.py (Engle-Granger, verified working against
real yfinance BIST data) and extended with a Johansen test, which is the more
robust choice for >2 assets / bidirectional cointegration since it doesn't
require picking a dependent variable and detects multiple cointegrating
relationships at once (Engle-Granger is kept because it is simpler, gives an
explicit hedge ratio, and is the cheaper first-pass screen).
"""
import numpy as np
import pandas as pd
import yfinance as yf
from statsmodels.tsa.stattools import adfuller
from statsmodels.regression.linear_model import OLS
from statsmodels.tools.tools import add_constant
from statsmodels.tsa.vector_ar.vecm import coint_johansen
from typing import Any, Dict


def fetch_pair_data(symbol_a: str, symbol_b: str, period: str = "2y") -> pd.DataFrame:
    """Fetches aligned daily closing prices for two BIST tickers via yfinance."""
    ticker_a = symbol_a if symbol_a.endswith(".IS") else f"{symbol_a}.IS"
    ticker_b = symbol_b if symbol_b.endswith(".IS") else f"{symbol_b}.IS"

    data_a = yf.download(ticker_a, period=period, progress=False)["Close"]
    data_b = yf.download(ticker_b, period=period, progress=False)["Close"]

    df = pd.concat([data_a, data_b], axis=1)
    df.columns = [symbol_a, symbol_b]
    return df.dropna()


def engle_granger_cointegration(df: pd.DataFrame, asset_a: str, asset_b: str) -> Dict[str, Any]:
    """
    Engle-Granger two-step cointegration test.
    Step 1: OLS regression of asset_a on asset_b.
    Step 2: Augmented Dickey-Fuller test on the regression residuals.
    """
    y = df[asset_a].values.astype(np.float64)
    x = df[asset_b].values.astype(np.float64)

    x_with_const = add_constant(x)
    model = OLS(y, x_with_const).fit()
    alpha, beta = model.params

    residuals = y - (alpha + beta * x)

    adf_result = adfuller(residuals, autolag='AIC')

    p_value = adf_result[1]
    t_stat = adf_result[0]
    critical_values = adf_result[4]

    return {
        "method": "engle_granger",
        "hedge_ratio_beta": float(beta),
        "intercept_alpha": float(alpha),
        "p_value": float(p_value),
        "t_stat": float(t_stat),
        "critical_value_5pct": float(critical_values["5%"]),
        "is_cointegrated": bool(p_value < 0.05),
    }


def johansen_cointegration(df: pd.DataFrame, asset_a: str, asset_b: str,
                            det_order: int = 0, k_ar_diff: int = 1) -> Dict[str, Any]:
    """
    Johansen cointegration test (trace statistic) for a basket of assets.

    Unlike Engle-Granger, Johansen does not require designating a dependent
    variable and can detect more than one cointegrating relationship among
    N > 2 series. Here it's applied to the same BIST pair for a direct,
    cross-checking comparison against the Engle-Granger result.

    :param det_order: -1 no deterministic term, 0 constant term, 1 linear trend
    :param k_ar_diff: number of lagged differences in the underlying VECM
    """
    price_matrix = df[[asset_a, asset_b]].values.astype(np.float64)

    result = coint_johansen(price_matrix, det_order, k_ar_diff)

    trace_stats = result.lr1  # trace statistic per rank hypothesis
    critical_values_90_95_99 = result.cvt  # shape (n, 3) columns = [90%, 95%, 99%]
    eigenvectors = result.evec

    # Rank = number of trace stats that exceed their 95% critical value
    rank = 0
    for i in range(len(trace_stats)):
        if trace_stats[i] > critical_values_90_95_99[i][1]:
            rank += 1
        else:
            break

    # First eigenvector gives the cointegrating vector (hedge ratio) for the
    # strongest relationship, normalized so asset_a's coefficient is 1.
    coint_vector = eigenvectors[:, 0]
    normalized_hedge_ratio = float(-coint_vector[1] / coint_vector[0]) if coint_vector[0] != 0 else None

    return {
        "method": "johansen",
        "trace_statistics": [float(v) for v in trace_stats],
        "critical_values_95pct": [float(row[1]) for row in critical_values_90_95_99],
        "cointegration_rank": rank,
        "is_cointegrated": bool(rank > 0),
        "hedge_ratio_from_eigenvector": normalized_hedge_ratio,
    }


def run_pairs_analysis(symbol_a: str, symbol_b: str, period: str = "2y") -> Dict[str, Any]:
    """Convenience wrapper: fetches data and runs both cointegration tests."""
    df = fetch_pair_data(symbol_a, symbol_b, period=period)
    if df.empty or len(df) < 30:
        raise ValueError(f"Insufficient overlapping price history for {symbol_a}/{symbol_b}.")

    eg = engle_granger_cointegration(df, symbol_a, symbol_b)
    jh = johansen_cointegration(df, symbol_a, symbol_b)

    return {
        "asset_a": symbol_a,
        "asset_b": symbol_b,
        "observations": int(len(df)),
        "engle_granger": eg,
        "johansen": jh,
        "consensus_cointegrated": bool(eg["is_cointegrated"] and jh["is_cointegrated"]),
    }


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Statistical Arbitrage Cointegration Engine")
    parser.add_argument("--asset_a", type=str, default="GARAN", help="Dependent variable (Y)")
    parser.add_argument("--asset_b", type=str, default="AKBNK", help="Independent variable (X)")
    args = parser.parse_args()

    print(f"[STAT-ARB] Fetching data for {args.asset_a}/{args.asset_b}...")
    result = run_pairs_analysis(args.asset_a, args.asset_b)

    print("\n=== ENGLE-GRANGER ===")
    eg = result["engle_granger"]
    print(f"Hedge Ratio (Beta) : {eg['hedge_ratio_beta']:.4f}")
    print(f"P-Value            : {eg['p_value']:.4f}")
    print(f"Cointegrated?      : {eg['is_cointegrated']}")

    print("\n=== JOHANSEN ===")
    jh = result["johansen"]
    print(f"Trace Statistics   : {jh['trace_statistics']}")
    print(f"95% Crit. Values   : {jh['critical_values_95pct']}")
    print(f"Cointegration Rank : {jh['cointegration_rank']}")
    print(f"Cointegrated?      : {jh['is_cointegrated']}")

    print(f"\nConsensus: {'COINTEGRATED' if result['consensus_cointegrated'] else 'NOT COINTEGRATED'}")
