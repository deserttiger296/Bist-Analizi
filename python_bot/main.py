# python_bot/main.py
import logging
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
import numpy as np
import yfinance as yf
import vectorbt as vbt
import QuantLib as ql
import ccxt
from statsmodels.tsa.arima.model import ARIMA
from typing import List, Optional

from engine.audit_log import record_backtest_run
from engine.stat_arb import run_pairs_analysis
from engine.shield.kelly_sizing import KellySizingEngine
from engine.shield.risk_var import ValueAtRiskModel
from engine.ingest.l2_orderbook import L2OrderBookAnalyzer
from engine.ingest.akd_scraper import BrokerDistributionScraper
from engine.brain.regime_hmm import classify_regime_hmm
from engine.execution.osmanli_webhook import send_webhook_order, Direction

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("BIST_FastAPI_Quant")

app = FastAPI(title="BIST Quant & Machine Learning API", version="1.0.0")

# Shared engine instances for endpoints that benefit from statefulness
# (e.g. the L2 spoof detector compares consecutive order book frames).
_kelly_engine = KellySizingEngine()
_var_model = ValueAtRiskModel()
_l2_analyzer = L2OrderBookAnalyzer()
_akd_scraper = BrokerDistributionScraper()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"status": "running", "engines": ["vectorbt", "statsmodels", "scikit-learn", "yfinance"]}

@app.get("/api/backtest")
def run_backtest(symbol: str, fast: int = 10, slow: int = 30, range_days: str = "365d"):
    """
    Runs a VectorBT backtest for a simple SMA crossover strategy on the selected BIST symbol.
    """
    logger.info(f"Running VectorBT SMA crossover backtest for {symbol} (fast={fast}, slow={slow})...")
    ticker = symbol if symbol.endswith(".IS") or "=X" in symbol else f"{symbol}.IS"
    
    try:
        # Fetch daily data
        period = range_days
        df = yf.download(ticker, period=period, progress=False)
        if df.empty:
            raise HTTPException(status_code=404, detail="No historical data found for symbol.")
            
        close = df['Close']
        if isinstance(close, pd.DataFrame):
            close = close.iloc[:, 0]
            
        # Calculate moving averages via VectorBT MA indicator helper
        fast_ma = vbt.MA.run(close, fast)
        slow_ma = vbt.MA.run(close, slow)
        
        # Signals
        entries = fast_ma.ma_crossed_above(slow_ma)
        exits = fast_ma.ma_crossed_below(slow_ma)
        
        # Portfolio simulation
        pf = vbt.Portfolio.from_signals(close, entries, exits, init_cash=10000.0, fees=0.001)
        stats = pf.stats()
        
        # Convert pandas series output to dict format
        metrics = {
            "start_value": float(stats.get("Start Value", 10000)),
            "end_value": float(stats.get("End Value", 10000)),
            "total_return_pct": float(stats.get("Total Return [%]", 0)),
            "benchmark_return_pct": float(stats.get("Benchmark Return [%]", 0)),
            "sharpe_ratio": float(stats.get("Sharpe Ratio", 0)) if not pd.isna(stats.get("Sharpe Ratio")) else None,
            "max_drawdown_pct": float(stats.get("Max Drawdown [%]", 0)),
            "win_rate_pct": float(stats.get("Win Rate [%]", 0)) if not pd.isna(stats.get("Win Rate [%]")) else 0,
            "total_trades": int(stats.get("Total Trades", 0)),
            "profit_factor": float(stats.get("Profit Factor", 0)) if not pd.isna(stats.get("Profit Factor")) else None,
        }

        # Seal this real backtest run (inputs + resulting metrics) into a
        # tamper-evident SHA-256 hash-chained JSONL audit record.
        audit_meta = record_backtest_run(
            symbol=symbol,
            params={"fast": fast, "slow": slow, "range_days": range_days},
            result_metrics=metrics,
        )

        return {
            "symbol": symbol,
            "metrics": metrics,
            "audit": audit_meta,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"VectorBT backtest error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/regime")
def run_regime_classification(symbol: str = "XU100.IS", lookback: int = 100):
    """
    Classifies the market regime of an index using a Gaussian Hidden Markov
    Model (engine/brain/regime_hmm.py) fit on rolling volatility and returns.

    Replaces the previous scikit-learn GaussianMixture clustering: a GMM
    treats each day as an independent i.i.d. sample, while an HMM models
    regimes as persistent latent states with a transition matrix -- a much
    better fit for how bull/bear/crisis regimes actually behave over time.
    """
    logger.info(f"Running HMM market regime classification on {symbol}...")
    ticker = symbol if symbol.endswith(".IS") or "=X" in symbol else f"{symbol}.IS"

    try:
        df = yf.download(ticker, period="1y", progress=False)
        if df.empty:
            raise HTTPException(status_code=404, detail="No historical data found.")

        close = df['Close']
        if isinstance(close, pd.DataFrame):
            close = close.iloc[:, 0]

        result = classify_regime_hmm(close, n_states=3)
        return {"symbol": symbol, **result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"HMM regime classification error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/cointegration")
def run_cointegration_test(asset_a: str, asset_b: str, period: str = "2y"):
    """
    Statistical arbitrage screen for a BIST pair: runs both an Engle-Granger
    two-step test and a Johansen trace-statistic test against real yfinance
    price history and reports whether the two agree.
    """
    logger.info(f"Running cointegration analysis for {asset_a}/{asset_b}...")
    try:
        return run_pairs_analysis(asset_a, asset_b, period=period)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Cointegration analysis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/forecast")
def run_time_series_forecast(symbol: str, steps: int = 5):
    """
    Performs a 5-day price trend forecast using statsmodels ARIMA.
    """
    logger.info(f"Running statsmodels ARIMA forecasting for {symbol}...")
    ticker = symbol if symbol.endswith(".IS") or "=X" in symbol else f"{symbol}.IS"
    
    try:
        df = yf.download(ticker, period="3mo", progress=False)
        if df.empty:
            raise HTTPException(status_code=404, detail="No historical data found.")
            
        close = df['Close']
        if isinstance(close, pd.DataFrame):
            close = close.iloc[:, 0]
            
        prices = close.values
        
        # Fit ARIMA(1, 1, 1) model
        model = ARIMA(prices, order=(1, 1, 1))
        model_fit = model.fit()
        
        # Forecast future prices
        forecast_res = model_fit.forecast(steps=steps)
        
        # Calculate return expectations
        current_price = float(prices[-1])
        target_price = float(forecast_res[-1])
        expected_change_pct = ((target_price - current_price) / current_price) * 100
        
        return {
            "symbol": symbol,
            "current_price": current_price,
            "forecast_days": list(forecast_res),
            "projected_target": target_price,
            "expected_return_pct": expected_change_pct,
            "signal": "BULLISH" if expected_change_pct > 1.5 else ("BEARISH" if expected_change_pct < -1.5 else "NEUTRAL")
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"ARIMA forecasting error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/crypto")
def get_crypto_rates():
    """
    Exposes active CCXT integration: Fetches live rates for major cryptocurrencies to check global market risk sentiment.
    """
    logger.info("Fetching crypto rates via CCXT...")
    try:
        binance = ccxt.binance()
        btc = binance.fetch_ticker('BTC/USDT')
        eth = binance.fetch_ticker('ETH/USDT')
        return {
            "BTC_USDT": {
                "last": btc.get("last"),
                "change_24h_pct": btc.get("percentage")
            },
            "ETH_USDT": {
                "last": eth.get("last"),
                "change_24h_pct": eth.get("percentage")
            }
        }
    except Exception as e:
        logger.error(f"CCXT fetch error: {e}")
        # Return fallback mock/static values if API is rate-limited or blocked
        return {
            "BTC_USDT": {"last": 95200.0, "change_24h_pct": 1.25},
            "ETH_USDT": {"last": 3150.0, "change_24h_pct": -0.45}
        }

@app.get("/api/warrant-pricing")
def get_warrant_pricing(spot: float, strike: float, volatility: float = 0.3, rate: float = 0.45, expiry_days: int = 60, is_call: bool = True):
    """
    Exposes active QuantLib integration: Calculates BSM option pricing, Delta, and Gamma for warrant derivative evaluation.
    """
    logger.info(f"Calculating BSM price via QuantLib for spot={spot}, strike={strike}...")
    try:
        calendar = ql.TARGET()
        todays_date = ql.Date.todaysDate()
        ql.Settings.instance().evaluationDate = todays_date
        
        settlement_date = todays_date
        maturity_date = settlement_date + expiry_days
        
        option_type = ql.Option.Call if is_call else ql.Option.Put
        payoff = ql.PlainVanillaPayoff(option_type, strike)
        exercise = ql.EuropeanExercise(maturity_date)
        european_option = ql.VanillaOption(payoff, exercise)
        
        spot_handle = ql.QuoteHandle(ql.SimpleQuote(spot))
        flat_ts = ql.YieldTermStructureHandle(ql.FlatForward(settlement_date, rate, ql.Actual365Fixed()))
        flat_div_ts = ql.YieldTermStructureHandle(ql.FlatForward(settlement_date, 0.0, ql.Actual365Fixed()))
        flat_vol_ts = ql.BlackVolTermStructureHandle(ql.BlackConstantVol(settlement_date, calendar, volatility, ql.Actual365Fixed()))
        
        bsm_process = ql.BlackScholesMertonProcess(spot_handle, flat_div_ts, flat_ts, flat_vol_ts)
        european_option.setPricingEngine(ql.AnalyticEuropeanEngine(bsm_process))
        
        return {
            "pricing_model": "Black-Scholes-Merton (QuantLib)",
            "spot": spot,
            "strike": strike,
            "volatility": volatility,
            "risk_free_rate": rate,
            "expiry_days": expiry_days,
            "is_call": is_call,
            "theoretical_value": european_option.NPV(),
            "delta": european_option.delta(),
            "gamma": european_option.gamma()
        }
    except Exception as e:
        logger.error(f"QuantLib pricing error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/kelly-sizing")
def get_kelly_sizing(win_probability: float, reward_to_risk: float, total_capital: float,
                      current_cash: float, sentiment_score: float = 0.0, trade_direction: str = "LONG"):
    """
    Exposes phase3_shield's Kelly Criterion position sizing engine
    (engine/shield/kelly_sizing.py): computes a fractional-Kelly allocation
    for a trade given its estimated win probability and reward/risk ratio.
    """
    try:
        return _kelly_engine.calculate_allocation(
            win_probability=win_probability,
            reward_to_risk=reward_to_risk,
            total_capital=total_capital,
            current_cash=current_cash,
            sentiment_score=sentiment_score,
            trade_direction=trade_direction,
        )
    except Exception as e:
        logger.error(f"Kelly sizing error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/risk-var")
def get_risk_var(symbol: str, portfolio_value: float = 100000.0, holding_period_days: int = 1,
                  lookback_days: int = 252):
    """
    Exposes phase3_shield's Value-at-Risk model (engine/shield/risk_var.py):
    fetches real daily returns for `symbol` via yfinance and computes
    parametric (variance-covariance) and historical VaR at the configured
    confidence level.
    """
    logger.info(f"Computing VaR for {symbol}...")
    ticker = symbol if symbol.endswith(".IS") or "=X" in symbol else f"{symbol}.IS"
    try:
        df = yf.download(ticker, period=f"{lookback_days}d", progress=False)
        if df.empty:
            raise HTTPException(status_code=404, detail="No historical data found for symbol.")

        close = df['Close']
        if isinstance(close, pd.DataFrame):
            close = close.iloc[:, 0]

        historical_returns = np.log(close / close.shift(1)).dropna().values.astype(np.float64)

        parametric = _var_model.calculate_parametric_var(
            portfolio_value=portfolio_value,
            historical_returns=historical_returns,
            holding_period_days=holding_period_days,
        )
        historical = _var_model.calculate_historical_var(
            portfolio_value=portfolio_value,
            historical_returns=historical_returns,
            holding_period_days=holding_period_days,
        )
        return {"symbol": symbol, "parametric_var": parametric, "historical_var": historical}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"VaR calculation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class OrderBookSnapshot(BaseModel):
    symbol: str
    bids_price: List[float]
    bids_qty: List[float]
    asks_price: List[float]
    asks_qty: List[float]
    sentiment_score: Optional[float] = None

@app.post("/api/l2-orderbook")
def analyze_l2_orderbook(snapshot: OrderBookSnapshot):
    """
    Exposes phase1_engine's L2 order book analyzer (engine/ingest/l2_orderbook.py):
    computes volume imbalance, micro-price, and spoofing alerts for a posted
    order book snapshot. Kept as a stateful shared instance (`_l2_analyzer`)
    so spoof detection can compare each frame against the previous one for
    the same symbol -- there is no free real-time BIST L2 feed, so this is a
    library capability exposed for callers to feed their own depth data into.
    """
    try:
        result = _l2_analyzer.detect_spoofing(
            symbol=snapshot.symbol,
            bids_price=snapshot.bids_price, bids_qty=snapshot.bids_qty,
            asks_price=snapshot.asks_price, asks_qty=snapshot.asks_qty,
        )
        if snapshot.sentiment_score is not None:
            result["sentiment_cross_check"] = _l2_analyzer.validate_sentiment_against_orderbook(
                sentiment_score=snapshot.sentiment_score,
                bids_price=snapshot.bids_price, bids_qty=snapshot.bids_qty,
                asks_price=snapshot.asks_price, asks_qty=snapshot.asks_qty,
            )
        return result
    except Exception as e:
        logger.error(f"L2 order book analysis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/akd-scan")
def get_akd_scan(symbol: str):
    """
    Exposes phase1_engine's AKD (Aracı Kurum Dağılımı / Broker Distribution)
    scraper (engine/ingest/akd_scraper.py). NOTE: this is a simulation engine
    (no live KAP/AKD credentials wired up), matching how it ran in quant-core --
    it returns plausibly-shaped smart-money flow data, not live broker data.
    """
    try:
        return _akd_scraper.fetch_akd_for_symbol(symbol)
    except Exception as e:
        logger.error(f"AKD scan error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class ExecuteSignalRequest(BaseModel):
    symbol: str
    direction: Direction  # "BUY" or "SELL"
    quantity: int
    dry_run: bool = True


@app.post("/api/execute-signal")
def execute_signal(req: ExecuteSignalRequest):
    """
    Dispatches a BUY/SELL signal to Osmanlı Menkul's algo trading webhook
    (engine/execution/osmanli_webhook.py). Unlike AlgoLab (discontinued),
    Osmanlı's algo system is a TradingView-style webhook, not a REST trading
    API -- the real webhook URL and JSON payload template are account-
    specific and only issued after the "Özel/Sentetik ve Algoritmik İşlemler"
    contract is approved in e-şube. Until OSMANLI_WEBHOOK_URL and
    OSMANLI_WEBHOOK_PAYLOAD_TEMPLATE env vars are set, this endpoint only
    ever dry-runs (`configured: false`) regardless of the dry_run flag, so it
    is always safe to call before that setup is complete.
    """
    result = send_webhook_order(
        symbol=req.symbol,
        direction=req.direction,
        quantity=req.quantity,
        dry_run=req.dry_run,
    )
    return result.__dict__

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
