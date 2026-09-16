# -*- coding: utf-8 -*-
"""
Institutional-Grade Quantitative Trading Architecture
Phase 2: Dynamic ML-Based Indicator Weighting Engine
"""

import numpy as np
from typing import Dict, List, Tuple, Any

class DynamicIndicatorWeightingEngine:
    def __init__(self, indicators: List[str], learning_rate: float = 0.05):
        """
        Initialize indicator weighting engine.
        
        :param indicators: List of indicator names (e.g., ['RSI', 'MACD', 'SUPERTREND', 'VOLUME'])
        :param learning_rate: Gradient-like adjustment rate for weight updates
        """
        self.indicators = indicators
        self.lr = learning_rate
        
        # Initialize uniform weights across all indicators
        n = len(indicators)
        self.weights = {ind: 1.0 / n for ind in indicators}
        
        # Track trailing performance stats per indicator
        self.historical_accuracy: Dict[str, List[float]] = {ind: [] for ind in indicators}
        
        # Current active regime
        self.current_regime = "UNKNOWN"

    def detect_market_regime(self, recent_returns: List[float], atr_pct: float) -> str:
        """
        Detect current market regime to heavily penalize or boost certain indicators.
        Uses recent volatility and directional drift to classify the market.
        """
        if len(recent_returns) < 10:
            return "UNKNOWN"
            
        returns_arr = np.array(recent_returns)
        cumulative_return = np.sum(returns_arr)
        volatility = np.std(returns_arr)
        
        # High volatility threshold (e.g., daily std dev > 2%)
        if volatility > 0.02 or atr_pct > 0.05:
            self.current_regime = "HIGH_VOLATILITY_CRISIS"
        elif cumulative_return > 0.03 and volatility < 0.015:
            self.current_regime = "TRENDING_BULL"
        elif cumulative_return < -0.03 and volatility < 0.015:
            self.current_regime = "TRENDING_BEAR"
        else:
            self.current_regime = "RANGE_BOUND"
            
        return self.current_regime

    def predict_weighted_score(self, current_signals: Dict[str, float]) -> Tuple[float, float, str]:
        """
        Calculate dynamic Confluence (Kesişim) Score (0 to 100).
        Categorized into Trend, Momentum, Volume, Multi-Timeframe.
        :param current_signals: Dict mapping indicator names to signal value (between -1.0 [Bearish] and +1.0 [Bullish])
        :return: Tuple (confluence_score 0-100, confidence 0-100, tier_string)
        """
        # Master Prompt Target Categories and Weights (Default Base)
        categories = {
            "Trend": {"weight": 0.30, "indicators": ["supertrend_dir", "adx", "is_above_hma", "ema_5_20_cross"]},
            "Momentum": {"weight": 0.30, "indicators": ["rsi_14", "tsi", "macd_histogram"]},
            "Volume": {"weight": 0.20, "indicators": ["volume_adjusted_macd_velocity"]},
            "Multi-Timeframe": {"weight": 0.20, "indicators": ["is_above_weekly_ema26", "is_above_2day_ema21", "dist_fib_382"]}
        }
        
        total_score = 0.0
        
        # Calculate Base Score (-1 to 1) for each category
        for cat_name, cat_data in categories.items():
            cat_sum = 0.0
            cat_count = 0
            
            for ind in cat_data["indicators"]:
                if ind in current_signals:
                    # ML Weights adjust the base category calculation internally
                    ml_weight = self.weights.get(ind, 1.0)
                    cat_sum += current_signals[ind] * ml_weight
                    cat_count += ml_weight
                    
            if cat_count > 0:
                cat_avg = cat_sum / cat_count
                total_score += cat_avg * cat_data["weight"]

        # Map total_score from [-1, 1] to Confluence Score [0, 100]
        # -1 -> 0
        #  0 -> 50
        #  1 -> 100
        confluence_score = ((total_score + 1.0) / 2.0) * 100.0
        
        # Guard limits
        confluence_score = max(0.0, min(100.0, confluence_score))
        confidence = abs(total_score) * 100.0

        # Master Prompt Specific Tiers
        if confluence_score >= 75:
            tier = "GÜÇLÜ AL"
        elif 60 <= confluence_score < 75:
            tier = "AL"
        elif 40 <= confluence_score < 60:
            tier = "TUT"
        elif 20 <= confluence_score < 40:
            tier = "SAT"
        else:
            tier = "GÜÇLÜ SAT"
            
        return float(confluence_score), float(confidence), tier

    def explain_prediction(self, current_signals: Dict[str, float]) -> Dict[str, Any]:
        """
        Explainable AI (XAI) Engine.
        Breaks down the final prediction into individual indicator contributions based on the Confluence categories.
        """
        confluence_score, confidence, tier = self.predict_weighted_score(current_signals)
        
        contributions = {}
        total_absolute_influence = 0.0
        
        for ind, signal in current_signals.items():
            if ind in self.weights:
                weight = self.weights[ind]
                raw_contrib = signal * weight
                contributions[ind] = raw_contrib
                total_absolute_influence += abs(raw_contrib)
                
        breakdown = []
        for ind, raw_c in contributions.items():
            if total_absolute_influence == 0:
                pct = 0.0
            else:
                pct = (raw_c / total_absolute_influence) * 100
            
            if raw_c > 0:
                role = "BULLISH_SUPPORT"
            elif raw_c < 0:
                role = "BEARISH_DRAG"
            else:
                role = "NEUTRAL"
                
            breakdown.append({
                "indicator": ind,
                "signal_value": signal,
                "dynamic_weight_pct": self.weights[ind] * 100,
                "contribution_pct": float(pct),
                "role": role
            })
            
        breakdown = sorted(breakdown, key=lambda x: abs(x['contribution_pct']), reverse=True)
        top_driver = breakdown[0]['indicator'] if breakdown else "NONE"
        
        return {
            "prediction_tier": tier,
            "confluence_score": float(confluence_score),
            "confidence": float(confidence),
            "top_driver": top_driver,
            "breakdown": breakdown
        }

    def update_weights(self, signals_history: List[Dict[str, float]], 
                       forward_returns: List[float], lookback_window: int = 30):
        """
        Backpropagation-like weighting model.
        Updates weights dynamically by evaluating the Information Coefficient (IC) 
        and correlation between each indicator's historical signal and subsequent price returns.
        
        :param signals_history: Chronological list of historical signal values.
        :param forward_returns: Chronological list of subsequent asset price returns.
        """
        if len(signals_history) < 5:
            return # Insufficient training data
            
        n_samples = min(len(signals_history), len(forward_returns), lookback_window)
        
        # Calculate trailing hit ratios (prediction vs outcome direction)
        performance_scores = {}
        for ind in self.indicators:
            correct_predictions = 0
            for i in range(1, n_samples + 1):
                signal = signals_history[-i].get(ind, 0.0)
                outcome = forward_returns[-i]
                
                # Check directional alignment
                if (signal > 0.05 and outcome > 0) or (signal < -0.05 and outcome < 0):
                    correct_predictions += 1
                elif abs(signal) <= 0.05 and abs(outcome) <= 0.01:
                    correct_predictions += 0.5 # Neutral correct
                    
            hit_ratio = correct_predictions / n_samples
            performance_scores[ind] = hit_ratio

        # Update weights using gradient adjustment towards high hit-ratio indicators
        raw_weights = {}
        for ind in self.indicators:
            hr = performance_scores.get(ind, 0.5)
            # Logarithmic gradient boost
            adjustment = np.log(hr / (1.0 - hr + 1e-10) + 1e-10)
            
            # Apply dynamic updates
            new_w = self.weights[ind] * (1.0 + self.lr * adjustment)
            raw_weights[ind] = max(new_w, 0.01) # Minimum 1% weight threshold

        # Softmax normalize weights to sum up to 1.0 (Capital allocation constraint)
        total_raw = sum(raw_weights.values())
        for ind in self.indicators:
            self.weights[ind] = raw_weights[ind] / total_raw
            
    def get_weights_summary(self) -> Dict[str, float]:
        return {ind: round(w * 100, 2) for ind, w in self.weights.items()}

# ====================================================================
# Dynamic Weighting Sandbox
# ====================================================================
if __name__ == "__main__":
    engine = DynamicIndicatorWeightingEngine(['RSI', 'MACD', 'SUPERTREND', 'VOLUME'])
    
    print("Initial Uniform Weights:")
    print(engine.get_weights_summary())
    
    # Simulate historical signal stream and price outputs (High volume correlation)
    signals_history = []
    forward_returns = []
    
    np.random.seed(12)
    for _ in range(50):
        # Let's mock a regime where VOLUME and SUPERTREND are extremely accurate, while RSI keeps fakeout-lagging
        volume_sig = np.random.choice([1.0, -1.0])
        supertrend_sig = volume_sig  # Perfect correlation
        rsi_sig = -volume_sig        # Inverse correlation (wrong signals)
        macd_sig = np.random.uniform(-1.0, 1.0)
        
        signals_history.append({
            'RSI': rsi_sig,
            'MACD': macd_sig,
            'SUPERTREND': supertrend_sig,
            'VOLUME': volume_sig
        })
        
        # Realized price return matches volume direction
        forward_returns.append(volume_sig * 0.02) 

    # Optimize and backpropagate weights
    engine.update_weights(signals_history, forward_returns)
    
    print("\nUpdated Weights (After ML-Training on Volatility Regimes):")
    print(engine.get_weights_summary())
    
    # Predict with new weights
    current_sig = {'RSI': -1.0, 'MACD': 0.1, 'SUPERTREND': 1.0, 'VOLUME': 1.0}
    
    # Test Regime Detection
    regime = engine.detect_market_regime(forward_returns, atr_pct=0.01)
    print(f"\nDetected Market Regime: {regime}")
    
    score, conf = engine.predict_weighted_score(current_sig)
    print(f"Target Prediction - Score: {score:.2f} | Confidence: {conf:.2f}%")
    
    # Explainable AI (XAI) Test
    print("\n--- XAI (Explainable AI) Prediction Autopsy ---")
    explanation = engine.explain_prediction(current_sig)
    print(f"Prediction: {explanation['prediction']} (Score: {explanation['final_score']:.2f})")
    print(f"Top Driver: {explanation['top_driver']}")
    print("Breakdown:")
    for item in explanation['breakdown']:
        sign = "+" if item['contribution_pct'] > 0 else ""
        print(f"  -> {item['indicator'].ljust(12)} | Contrib: {sign}{item['contribution_pct']:.1f}% | Role: {item['role']} | Weight: {item['dynamic_weight_pct']:.1f}%")
