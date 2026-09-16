# -*- coding: utf-8 -*-
"""
Institutional-Grade Quantitative Trading Architecture
Phase 2: Alpha Generation & Advanced Feature Engineering
"""

import numpy as np
import pandas as pd
from typing import Union, List

class QuantFeatureExtractor:
    def __init__(self):
        pass

    @staticmethod
    def calculate_rsi(prices: np.ndarray, period: int = 14) -> np.ndarray:
        """
        Standard Wilders RSI calculation utilizing numpy and pandas vectors.
        """
        if len(prices) <= period:
            return np.zeros_like(prices)
            
        deltas = np.diff(prices)
        
        up = np.clip(deltas, a_min=0, a_max=None)
        down = -np.clip(deltas, a_min=None, a_max=0)
        
        up_s = pd.Series(up)
        down_s = pd.Series(down)
        
        up_sma = up_s.rolling(window=period).mean()
        down_sma = down_s.rolling(window=period).mean()
        
        up_s.iloc[:period-1] = np.nan
        down_s.iloc[:period-1] = np.nan
        
        up_s.iloc[period-1] = up_sma.iloc[period-1]
        down_s.iloc[period-1] = down_sma.iloc[period-1]
        
        up_ewm = up_s.ewm(alpha=1/period, adjust=False).mean().values
        down_ewm = down_s.ewm(alpha=1/period, adjust=False).mean().values
        
        rs = up_ewm / np.where(down_ewm == 0, 1e-10, down_ewm)
        
        rsi = np.zeros_like(prices)
        rsi[1:] = 100. - 100. / (1. + rs)
        
        if len(rsi) > period:
            rsi[:period+1] = rsi[period]
            
        return rsi

    @staticmethod
    def calculate_atr(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14) -> np.ndarray:
        """
        True Range & Average True Range calculation utilizing numpy/pandas vectors.
        """
        n = len(closes)
        if n <= period:
            return np.zeros(n)
            
        prev_closes = np.roll(closes, 1)
        prev_closes[0] = closes[0]
        
        h_l = highs - lows
        h_pc = np.abs(highs - prev_closes)
        l_pc = np.abs(lows - prev_closes)
        
        tr = np.maximum(h_l, np.maximum(h_pc, l_pc))
        tr[0] = 0.0
        
        tr_s = pd.Series(tr)
        
        tr_sma = tr_s.rolling(window=period).mean()
        
        tr_s.iloc[:period] = np.nan
        tr_s.iloc[period] = tr_sma.iloc[period]
        
        atr = tr_s.ewm(alpha=1/period, adjust=False).mean().fillna(0.0).values
        
        return atr

    @staticmethod
    def calculate_tsi(closes: np.ndarray, long_period: int = 25, short_period: int = 13) -> np.ndarray:
        """
        True Strength Index (TSI) calculation utilizing numpy/pandas.
        Identifies trend strength and divergences with less lag than RSI.
        """
        if len(closes) <= long_period + short_period:
            return np.zeros(len(closes))
            
        pc = pd.Series(np.diff(closes, prepend=closes[0]))
        
        # Double Smoothed PC
        pcs = pc.ewm(span=long_period, adjust=False).mean()
        pcds = pcs.ewm(span=short_period, adjust=False).mean()
        
        # Double Smoothed Absolute PC
        apc = pc.abs()
        apcs = apc.ewm(span=long_period, adjust=False).mean()
        apcds = apcs.ewm(span=short_period, adjust=False).mean()
        
        tsi = 100 * (pcds / np.where(apcds == 0, 1e-10, apcds))
        return tsi.values

    @staticmethod
    def calculate_fibonacci_proximity(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, window: int = 50) -> pd.DataFrame:
        """
        Calculates rolling Fibonacci Retracement levels over a window
        and returns the distance from the current price to the 0.382 and 0.618 Golden Ratios.
        """
        if len(closes) < window:
            return pd.DataFrame({'dist_fib_382': np.zeros(len(closes)), 'dist_fib_618': np.zeros(len(closes))})
            
        df = pd.DataFrame({'high': highs, 'low': lows, 'close': closes})
        rolling_max = df['high'].rolling(window=window).max()
        rolling_min = df['low'].rolling(window=window).min()
        
        diff = rolling_max - rolling_min
        
        fib_382 = rolling_max - diff * 0.382
        fib_618 = rolling_max - diff * 0.618
        
        # Distance normalized by price (percentage distance)
        dist_382 = (df['close'] - fib_382) / df['close']
        dist_618 = (df['close'] - fib_618) / df['close']
        
        return pd.DataFrame({'dist_fib_382': dist_382.fillna(0.0), 'dist_fib_618': dist_618.fillna(0.0)})

    @staticmethod
    def calculate_hull_ma(closes: np.ndarray, period: int = 14) -> np.ndarray:
        """
        Hull Moving Average (HMA) - Extremely fast moving average that reduces lag.
        Formula: WMA(2*WMA(n/2) - WMA(n), sqrt(n))
        """
        if len(closes) <= period:
            return np.zeros_like(closes)
            
        s = pd.Series(closes)
        
        # Helper for WMA
        def wma(series, length):
            weights = np.arange(1, length + 1)
            return series.rolling(length).apply(lambda x: np.dot(x, weights) / weights.sum(), raw=True)
            
        wma_half = wma(s, int(period/2))
        wma_full = wma(s, period)
        
        raw_hma = 2 * wma_half - wma_full
        hma = wma(raw_hma, int(np.sqrt(period)))
        
        return hma.fillna(0.0).values

    @staticmethod
    def calculate_adx(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14) -> pd.DataFrame:
        """
        Average Directional Index (ADX). Measures Trend Strength.
        """
        if len(closes) <= period:
            return pd.DataFrame({'adx': np.zeros(len(closes)), 'di_plus': np.zeros(len(closes)), 'di_minus': np.zeros(len(closes))})
            
        df = pd.DataFrame({'high': highs, 'low': lows, 'close': closes})
        
        up = df['high'] - df['high'].shift(1)
        down = df['low'].shift(1) - df['low']
        
        plus_dm = np.where((up > down) & (up > 0), up, 0.0)
        minus_dm = np.where((down > up) & (down > 0), down, 0.0)
        
        # Use ATR helper logic (assume we recalculate basic TR here for safety)
        prev_close = df['close'].shift(1)
        tr1 = df['high'] - df['low']
        tr2 = (df['high'] - prev_close).abs()
        tr3 = (df['low'] - prev_close).abs()
        tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
        
        atr = tr.ewm(alpha=1/period, adjust=False).mean()
        
        plus_di = 100 * (pd.Series(plus_dm).ewm(alpha=1/period, adjust=False).mean() / atr)
        minus_di = 100 * (pd.Series(minus_dm).ewm(alpha=1/period, adjust=False).mean() / atr)
        
        dx = 100 * (abs(plus_di - minus_di) / (plus_di + minus_di + 1e-8))
        adx = dx.ewm(alpha=1/period, adjust=False).mean()
        
        return pd.DataFrame({'adx': adx.fillna(0.0), 'di_plus': plus_di.fillna(0.0), 'di_minus': minus_di.fillna(0.0)})

    @staticmethod
    def calculate_supertrend(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 10, multiplier: float = 3.0) -> pd.DataFrame:
        """
        Supertrend Indicator - Dynamic ATR based trend trailing stop.
        """
        if len(closes) <= period:
            return pd.DataFrame({'supertrend': np.zeros(len(closes)), 'direction': np.zeros(len(closes))})
            
        df = pd.DataFrame({'high': highs, 'low': lows, 'close': closes})
        hl2 = (df['high'] + df['low']) / 2
        
        # Calculate TR/ATR locally for the exact period
        tr = np.maximum(df['high'] - df['low'], 
             np.maximum((df['high'] - df['close'].shift(1)).abs(), 
                        (df['low'] - df['close'].shift(1)).abs()))
        atr = tr.ewm(alpha=1/period, adjust=False).mean()
        
        basic_ub = hl2 + (multiplier * atr)
        basic_lb = hl2 - (multiplier * atr)
        
        final_ub = np.zeros(len(df))
        final_lb = np.zeros(len(df))
        supertrend = np.zeros(len(df))
        direction = np.ones(len(df)) # 1 for Bullish, -1 for Bearish
        
        # Vectorized calculation is complex for Supertrend due to recursive dependencies,
        # using a rapid loop
        for i in range(1, len(df)):
            final_ub[i] = basic_ub.iloc[i] if basic_ub.iloc[i] < final_ub[i-1] or df['close'].iloc[i-1] > final_ub[i-1] else final_ub[i-1]
            final_lb[i] = basic_lb.iloc[i] if basic_lb.iloc[i] > final_lb[i-1] or df['close'].iloc[i-1] < final_lb[i-1] else final_lb[i-1]
            
            if supertrend[i-1] == final_ub[i-1]:
                direction[i] = -1 if df['close'].iloc[i] <= final_ub[i] else 1
            else:
                direction[i] = 1 if df['close'].iloc[i] >= final_lb[i] else -1
                
            supertrend[i] = final_lb[i] if direction[i] == 1 else final_ub[i]
            
        return pd.DataFrame({'supertrend': supertrend, 'direction': direction})

    def extract_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Inject high-alpha mathematical features into standard OHLCV dataset.
        
        Required columns in DataFrame: 'open', 'high', 'low', 'close', 'volume'
        """
        # Ensure working copy
        feat_df = df.copy()
        
        closes = feat_df['close'].values
        highs = feat_df['high'].values
        lows = feat_df['low'].values
        volumes = feat_df['volume'].values
        
        # 1. Base Core Calculations
        rsi_14 = self.calculate_rsi(closes, 14)
        atr_14 = self.calculate_atr(highs, lows, closes, 14)
        
        feat_df['rsi_14'] = rsi_14
        feat_df['atr_14'] = atr_14

        # 1.1 Master Prompt Indicators (Supertrend, ADX, Hull MA, EMA 5/20 Cross)
        supertrend_df = self.calculate_supertrend(highs, lows, closes, 10, 3.0)
        adx_df = self.calculate_adx(highs, lows, closes, 14)
        
        feat_df['supertrend'] = supertrend_df['supertrend']
        feat_df['supertrend_dir'] = supertrend_df['direction'] # 1 (Bull) or -1 (Bear)
        
        feat_df['adx'] = adx_df['adx']
        feat_df['adx_di_plus'] = adx_df['di_plus']
        feat_df['adx_di_minus'] = adx_df['di_minus']
        
        feat_df['hull_ma_14'] = self.calculate_hull_ma(closes, 14)
        # Hull Kırılımı (Price crossing Hull MA)
        feat_df['is_above_hma'] = np.where(feat_df['close'] > feat_df['hull_ma_14'], 1.0, -1.0)
        
        # EMA 5/20 Cross
        feat_df['ema_5'] = pd.Series(closes).ewm(span=5, adjust=False).mean()
        feat_df['ema_20'] = pd.Series(closes).ewm(span=20, adjust=False).mean()
        feat_df['ema_5_20_cross'] = np.where(feat_df['ema_5'] > feat_df['ema_20'], 1.0, -1.0)

        # 2. Derivative of RSI over 3 and 5 intervals (d(RSI)/dt)
        # Identifies momentum acceleration/deceleration before absolute boundaries are hit
        feat_df['rsi_derivative_3'] = feat_df['rsi_14'].diff(3)
        feat_df['rsi_derivative_5'] = feat_df['rsi_14'].diff(5)

        # 3. Relative ATR Price Divergence
        # Measures if price is extending beyond normal trailing volatility thresholds (Mean Reversion)
        feat_df['atr_div_pct'] = (feat_df['close'] - feat_df['close'].rolling(20).mean()) / (feat_df['atr_14'] + 1e-8)

        # 4. Volume-Adjusted MACD Velocity
        # Standard MACD uses price difference. We weight the histogram changes by volume velocity.
        ema_12 = pd.Series(closes).ewm(span=12, adjust=False).mean()
        ema_26 = pd.Series(closes).ewm(span=26, adjust=False).mean()
        macd = ema_12 - ema_26
        signal = macd.ewm(span=9, adjust=False).mean()
        histogram = macd - signal
        
        feat_df['macd_histogram'] = histogram
        
        # Volume Z-score to measure institutional activity acceleration
        vol_mean = feat_df['volume'].rolling(20).mean()
        vol_std = feat_df['volume'].rolling(20).std().replace(0, 1e-8)
        vol_zscore = (feat_df['volume'] - vol_mean) / vol_std
        
        # Multiply momentum rate of change by volume z-score
        feat_df['volume_adjusted_macd_velocity'] = feat_df['macd_histogram'].diff(2) * vol_zscore

        # 5. Price Acceleration (2nd derivative of Close)
        feat_df['price_velocity'] = feat_df['close'].diff(1)
        feat_df['price_acceleration'] = feat_df['price_velocity'].diff(1)
        
        # 6. TSI (True Strength Index) - Phase 10 Upgrade
        feat_df['tsi'] = self.calculate_tsi(closes)
        feat_df['tsi_divergence'] = feat_df['tsi'] - feat_df['rsi_14'] # Spot fake-outs
        
        # 7. Dynamic Fibonacci Proximity - Phase 10 Upgrade
        fib_features = self.calculate_fibonacci_proximity(highs, lows, closes, window=50)
        feat_df['dist_fib_382'] = fib_features['dist_fib_382']
        feat_df['dist_fib_618'] = fib_features['dist_fib_618']

        # 8. Multi-Timeframe (Çoklu Zaman Dilimi) Sentetik EMA Sensörleri
        # Haftalık (Weekly) EMA 26 -> Günlük grafikte yaklaşık 130 bar (26 hafta * 5 gün)
        # 2 Günlük (2D) EMA 21 -> Günlük grafikte yaklaşık 42 bar (21 periyot * 2 gün)
        ema_130_w26 = pd.Series(closes).ewm(span=130, adjust=False).mean()
        ema_42_2d21 = pd.Series(closes).ewm(span=42, adjust=False).mean()
        
        feat_df['ema_weekly_26'] = ema_130_w26
        feat_df['ema_2day_21'] = ema_42_2d21
        
        # Matematiksel Öncelik Sinyalleri (Trend Filtreleri)
        # Fiyat, Haftalık EMA 26'nın üzerinde mi? (Uzun Vade Trend Onayı)
        feat_df['is_above_weekly_ema26'] = np.where(feat_df['close'] > feat_df['ema_weekly_26'], 1.0, -1.0)
        # Fiyat, 2 Günlük EMA 21'in üzerinde mi? (Orta Vade Momentum Onayı)
        feat_df['is_above_2day_ema21'] = np.where(feat_df['close'] > feat_df['ema_2day_21'], 1.0, -1.0)

        # 9. Multi-Timeframe Sentiment Divergence (Phase 8 Upgrade)
        # Checks if sentiment columns exist (usually joined from finbert_sentiment.py by the ingestion pipeline)
        if 'sentiment_1h' in feat_df.columns and 'sentiment_8h' in feat_df.columns:
            # Continuous Divergence Score
            feat_df['sentiment_divergence_1h_8h'] = feat_df['sentiment_1h'] - feat_df['sentiment_8h']
            
            # Binary signal for extreme panic/fomo trend breaks
            # E.g., Macro is Bullish (>0.2) but Micro is Panic (< -0.2)
            feat_df['sentiment_panic_break'] = np.where(
                (feat_df['sentiment_8h'] > 0.2) & (feat_df['sentiment_1h'] < -0.2), 
                -1,  # Short signal
                np.where((feat_df['sentiment_8h'] < -0.2) & (feat_df['sentiment_1h'] > 0.2), 1, 0) # Buy signal
            )

        # Clean NaN values arising from trailing rolling windows
        feat_df.fillna(0.0, inplace=True)
        
        return feat_df

# ====================================================================
# Feature Engineering Sandbox
# ====================================================================
if __name__ == "__main__":
    # Generate mock daily BIST bar set (100 days)
    np.random.seed(42)
    days = 100
    
    mock_close = 300.0 + np.cumsum(np.random.normal(1.5, 4.0, days))
    mock_high = mock_close + np.random.uniform(1.0, 8.0, days)
    mock_low = mock_close - np.random.uniform(1.0, 8.0, days)
    mock_open = mock_close + np.random.normal(0.0, 2.0, days)
    mock_vol = np.random.uniform(100000, 2000000, days)
    
    df = pd.DataFrame({
        'open': mock_open,
        'high': mock_high,
        'low': mock_low,
        'close': mock_close,
        'volume': mock_vol,
        'sentiment_1h': np.random.uniform(-1.0, 1.0, days),
        'sentiment_4h': np.random.uniform(-0.5, 0.5, days),
        'sentiment_8h': np.random.uniform(0.1, 0.6, days) # Bullish macro bias
    })
    
    extractor = QuantFeatureExtractor()
    extracted_df = extractor.extract_features(df)
    
    print("Features Extracted Successfully!")
    print(extracted_df[['close', 'rsi_14', 'tsi', 'dist_fib_618', 'volume_adjusted_macd_velocity']].tail(5))
