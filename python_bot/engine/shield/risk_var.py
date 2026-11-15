# -*- coding: utf-8 -*-
"""
Institutional-Grade Quantitative Trading Architecture
Phase 3: Quantitative Portfolio Risk - Value at Risk (VaR)
"""

import math
from statistics import NormalDist
import numpy as np
from typing import Dict, Any, List

_STD_NORM = NormalDist(0.0, 1.0)
try:
    from scipy.stats import norm as _scipy_norm
    def _norm_ppf(p: float) -> float:
        return float(_scipy_norm.ppf(p))
    def _norm_pdf(z: float) -> float:
        return float(_scipy_norm.pdf(z))
except ImportError:
    def _norm_ppf(p: float) -> float:
        return float(_STD_NORM.inv_cdf(p))
    def _norm_pdf(z: float) -> float:
        return float(_STD_NORM.pdf(z))

class ValueAtRiskModel:
    def __init__(self, confidence_level: float = 0.99):
        """
        Initialize VaR and CVaR (Expected Shortfall) calculator.
        
        :param confidence_level: Risk threshold (usually 0.95 or 0.99)
        """
        if not (isinstance(confidence_level, (int, float)) and math.isfinite(confidence_level) and 0.0 < float(confidence_level) < 1.0):
            raise ValueError("confidence_level must be finite and strictly between 0 and 1.")
        self.conf = float(confidence_level)
        # Z-score lookup for common confidence bounds
        self.z_score = _norm_ppf(self.conf)

    @staticmethod
    def _clean_returns(historical_returns: Any) -> tuple[np.ndarray, bool]:
        if historical_returns is None:
            return np.array([], dtype=float), False
        try:
            arr = np.asarray(historical_returns, dtype=float)
        except (ValueError, TypeError):
            return np.array([], dtype=float), False
        if arr.ndim != 1:
            return np.array([], dtype=float), False
        return arr[np.isfinite(arr)], True

    def calculate_parametric_var(self, portfolio_value: float, historical_returns: np.ndarray, 
                                 holding_period_days: int = 1) -> Dict[str, Any]:
        """
        Calculate Parametric (Variance-Covariance) Value at Risk and Expected Shortfall (CVaR).
        Formula:
            VaR  = Z * sigma * sqrt(t) * V
            CVaR = (phi(Z) / (1 - conf)) * sigma * sqrt(t) * V
        """
        clean_ret, is_valid_shape = self._clean_returns(historical_returns)
        if (
            not is_valid_shape
            or not (isinstance(portfolio_value, (int, float)) and not isinstance(portfolio_value, bool) and math.isfinite(portfolio_value) and portfolio_value > 0)
            or not (isinstance(holding_period_days, (int, float)) and not isinstance(holding_period_days, bool) and math.isfinite(holding_period_days) and holding_period_days > 0)
        ):
            return {
                "var_absolute": 0.0,
                "var_pct": 0.0,
                "cvar_absolute": 0.0,
                "cvar_pct": 0.0,
                "status": "INVALID_INPUT"
            }
        if len(clean_ret) < 5:
            return {
                "var_absolute": 0.0,
                "var_pct": 0.0,
                "cvar_absolute": 0.0,
                "cvar_pct": 0.0,
                "status": "INSUFFICIENT_DATA"
            }
            
        sigma = float(np.std(clean_ret))
        
        # Apply square-root-of-time rule for multi-day horizons
        time_scalar = float(np.sqrt(holding_period_days))
        
        var_pct = self.z_score * sigma * time_scalar
        var_absolute = var_pct * float(portfolio_value)

        alpha = 1.0 - self.conf
        cvar_1d_pct = (_norm_pdf(self.z_score) / alpha) * sigma
        cvar_pct = cvar_1d_pct * time_scalar
        cvar_absolute = cvar_pct * float(portfolio_value)
        
        return {
            "var_absolute": float(var_absolute),
            "var_pct": float(var_pct * 100),
            "cvar_absolute": float(cvar_absolute),
            "cvar_pct": float(cvar_pct * 100),
            "confidence_level": self.conf,
            "horizon_days": holding_period_days,
            "sigma_daily": float(sigma),
            "status": "SUCCESS"
        }

    def calculate_historical_var(self, portfolio_value: float, historical_returns: np.ndarray, 
                                 holding_period_days: int = 1) -> Dict[str, Any]:
        """
        Calculate Value at Risk and Expected Shortfall (CVaR) using Historical Simulation.
        Does not assume normal distribution of returns (highly robust for BIST tavan/taban spikes).
        """
        clean_ret, is_valid_shape = self._clean_returns(historical_returns)
        if (
            not is_valid_shape
            or not (isinstance(portfolio_value, (int, float)) and not isinstance(portfolio_value, bool) and math.isfinite(portfolio_value) and portfolio_value > 0)
            or not (isinstance(holding_period_days, (int, float)) and not isinstance(holding_period_days, bool) and math.isfinite(holding_period_days) and holding_period_days > 0)
        ):
            return {
                "var_absolute": 0.0,
                "var_pct": 0.0,
                "cvar_absolute": 0.0,
                "cvar_pct": 0.0,
                "status": "INVALID_INPUT"
            }
        if len(clean_ret) < 5:
            return {
                "var_absolute": 0.0,
                "var_pct": 0.0,
                "cvar_absolute": 0.0,
                "cvar_pct": 0.0,
                "status": "INSUFFICIENT_DATA"
            }
            
        # Target index corresponding to confidence level threshold
        alpha = 1.0 - self.conf
        sorted_returns = np.sort(clean_ret)
        
        percentile_idx = int(np.floor(alpha * len(sorted_returns)))
        percentile_idx = max(0, min(percentile_idx, len(sorted_returns) - 1))
        historical_var_1d_pct = float(-sorted_returns[percentile_idx])
        
        # Historical CVaR (Expected Shortfall): mean of tail losses at or beyond the VaR cutoff
        tail_losses = -sorted_returns[:percentile_idx + 1]
        historical_cvar_1d_pct = float(np.mean(tail_losses))
        
        # Time scaling (under standard i.i.d. assumption)
        time_scalar = float(np.sqrt(holding_period_days))
        
        var_pct = historical_var_1d_pct * time_scalar
        var_absolute = var_pct * float(portfolio_value)
        cvar_pct = historical_cvar_1d_pct * time_scalar
        cvar_absolute = cvar_pct * float(portfolio_value)
        
        return {
            "var_absolute": float(var_absolute),
            "var_pct": float(var_pct * 100),
            "cvar_absolute": float(cvar_absolute),
            "cvar_pct": float(cvar_pct * 100),
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
