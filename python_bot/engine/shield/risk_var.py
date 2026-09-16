# -*- coding: utf-8 -*-
"""
Institutional-Grade Quantitative Trading Architecture
Phase 3: Quantitative Portfolio Risk - Value at Risk (VaR)
"""

import numpy as np
from scipy.stats import norm
from typing import Dict, Any, List

class ValueAtRiskModel:
    def __init__(self, confidence_level: float = 0.99):
        """
        Initialize VaR calculator.
        
        :param confidence_level: Risk threshold (usually 0.95 or 0.99)
        """
        self.conf = confidence_level
        # Z-score lookup for common confidence bounds
        self.z_score = norm.ppf(confidence_level)

    def calculate_parametric_var(self, portfolio_value: float, historical_returns: np.ndarray, 
                                 holding_period_days: int = 1) -> Dict[str, Any]:
        """
        Calculate Parametric (Variance-Covariance) Value at Risk.
        Formula:
            VaR = Z * sigma * sqrt(t) * V
            Where:
                Z = Z-score matching confidence level (e.g., 2.33 for 99%)
                sigma = Standard deviation of historical portfolio returns
                t = Holding period days
                V = Total portfolio value
        """
        if len(historical_returns) < 5:
            return {"var_absolute": 0.0, "var_pct": 0.0, "status": "INSUFFICIENT_DATA"}
            
        sigma = np.std(historical_returns)
        
        # Apply square-root-of-time rule for multi-day horizons
        time_scalar = np.sqrt(holding_period_days)
        
        var_pct = self.z_score * sigma * time_scalar
        var_absolute = var_pct * portfolio_value
        
        return {
            "var_absolute": float(var_absolute),
            "var_pct": float(var_pct * 100),
            "confidence_level": self.conf,
            "horizon_days": holding_period_days,
            "sigma_daily": float(sigma),
            "status": "SUCCESS"
        }

    def calculate_historical_var(self, portfolio_value: float, historical_returns: np.ndarray, 
                                 holding_period_days: int = 1) -> Dict[str, Any]:
        """
        Calculate Value at Risk using Historical Simulation.
        Does not assume normal distribution of returns (highly robust for volatile asset spikes).
        
        Sorts historical outcomes and extracts the lower percentile matching the confidence level.
        """
        if len(historical_returns) < 5:
            return {"var_absolute": 0.0, "var_pct": 0.0, "status": "INSUFFICIENT_DATA"}
            
        # Target index corresponding to confidence level threshold
        alpha = 1.0 - self.conf
        sorted_returns = np.sort(historical_returns)
        
        percentile_idx = int(np.floor(alpha * len(sorted_returns)))
        historical_var_1d_pct = -sorted_returns[percentile_idx]
        
        # Time scaling (under standard i.i.d. assumption)
        time_scalar = np.sqrt(holding_period_days)
        
        var_pct = historical_var_1d_pct * time_scalar
        var_absolute = var_pct * portfolio_value
        
        return {
            "var_absolute": float(var_absolute),
            "var_pct": float(var_pct * 100),
            "confidence_level": self.conf,
            "horizon_days": holding_period_days,
            "status": "SUCCESS"
        }

# ====================================================================
# Value at Risk Model Sandbox
# ====================================================================
if __name__ == "__main__":
    var_model = ValueAtRiskModel(confidence_level=0.99) # 99% Conf
    
    portfolio_val = 500000.0 # 500,000₺
    
    # Generate mock daily returns (normal distribution with fat-tail outliers)
    np.random.seed(42)
    daily_rets = np.random.normal(0.0005, 0.015, 500) # 1.5% daily volatility
    
    # Inject heavy-tail risk outliers (extreme days)
    daily_rets[10] = -0.075
    daily_rets[100] = -0.091
    daily_rets[250] = -0.068
    
    # Parametric Calculation
    res_p = var_model.calculate_parametric_var(portfolio_val, daily_rets, holding_period_days=5)
    print("Parametric Value at Risk (5-Day Horizon, 99% Conf):")
    print(f"  Max Expected Loss: {res_p['var_absolute']:.2f}₺ | Percent: {res_p['var_pct']:.2f}%")
    
    # Historical Simulation Calculation
    res_h = var_model.calculate_historical_var(portfolio_val, daily_rets, holding_period_days=5)
    print("\nHistorical Simulation Value at Risk (5-Day Horizon, 99% Conf):")
    print(f"  Max Expected Loss: {res_h['var_absolute']:.2f}₺ | Percent: {res_h['var_pct']:.2f}%")
    print("  *Historical VaR is higher here because it accurately captures the custom fat-tail outliers!*")
