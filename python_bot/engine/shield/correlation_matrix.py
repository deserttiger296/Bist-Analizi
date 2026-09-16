# -*- coding: utf-8 -*-
"""
Institutional-Grade Quantitative Trading Architecture
Phase 3: Dynamic Portfolio Covariance & Sector Exposure Checker
"""

import numpy as np
import pandas as pd
from typing import Dict, List, Tuple, Any

class PortfolioCorrelationController:
    def __init__(self, max_correlation_threshold: float = 0.70):
        """
        Initialize portfolio correlation check engine.
        
        :param max_correlation_threshold: Maximum allowed correlation coefficient with active holdings.
        """
        self.max_corr = max_correlation_threshold
        # Track active holdings in portfolio
        self.active_holdings: List[str] = []
        # Store historical daily returns of active assets
        self.returns_cache: Dict[str, np.ndarray] = {}

    def update_holdings(self, holdings: List[str], returns_data: Dict[str, np.ndarray]):
        """
        Update the current portfolio holdings and returns data cache.
        """
        self.active_holdings = holdings
        self.returns_cache = {sym: np.array(ret) for sym, ret in returns_data.items() if sym in holdings}

    def check_exposure_limit(self, target_symbol: str, target_returns: np.ndarray) -> Dict[str, Any]:
        """
        Check if adding the target asset would breach portfolio correlation limits.
        Prevents buying assets in the same sector during severe downturns (Double exposure).
        
        Formula:
            Pearson Correlation Coefficient = Cov(X, Y) / (Std(X) * Std(Y))
        """
        if not self.active_holdings:
            return {"authorized": True, "avg_correlation": 0.0, "status": "APPROVED_EMPTY_PORTFOLIO"}
            
        t_ret = np.array(target_returns)
        correlations = []
        breached_assets = []
        
        for sym in self.active_holdings:
            if sym not in self.returns_cache:
                continue
                
            hold_ret = self.returns_cache[sym]
            
            # Align history length
            min_len = min(len(t_ret), len(hold_ret))
            if min_len < 5:
                continue
                
            x = t_ret[-min_len:]
            y = hold_ret[-min_len:]
            
            # Compute pearson correlation
            std_x = np.std(x)
            std_y = np.std(y)
            if std_x == 0 or std_y == 0:
                corr = 0.0
            else:
                corr = np.cov(x, y)[0, 1] / (std_x * std_y)
                
            correlations.append(corr)
            if corr > self.max_corr:
                breached_assets.append((sym, float(corr)))

        if not correlations:
            return {"authorized": True, "avg_correlation": 0.0, "status": "APPROVED_NO_MATCHING_HISTORY"}
            
        avg_corr = float(np.mean(correlations))
        authorized = len(breached_assets) == 0
        
        return {
            "authorized": authorized,
            "avg_correlation": avg_corr,
            "breached_active_assets": breached_assets,
            "status": "APPROVED" if authorized else "BLOCKED_HIGH_CORRELATION",
            "message": f"Execution cleared. Avg correlation with portfolio is {avg_corr:.2f}" if authorized else f"Trade blocked! Highly correlated with holdings: {breached_assets}"
        }

# ====================================================================
# Correlation Controller Sandbox
# ====================================================================
if __name__ == "__main__":
    controller = PortfolioCorrelationController(max_correlation_threshold=0.70)
    
    # Generate mock returns for portfolio holdings (Banking Sector Group)
    np.random.seed(42)
    days = 100
    
    akbnk_ret = np.random.normal(0.001, 0.015, days)
    isctr_ret = akbnk_ret + np.random.normal(0.0, 0.005, days) # High correlation
    
    # Add a diversified stock return (Defense Sector)
    asels_ret = np.random.normal(0.0005, 0.02, days)
    
    # Target stock returns (Garanti Bank - also Banking sector, high correlation)
    garan_ret = akbnk_ret + np.random.normal(0.0, 0.004, days)
    
    # Configure portfolio holdings
    holdings = ["AKBNK", "ASELS"]
    returns_db = {"AKBNK": akbnk_ret, "ASELS": asels_ret}
    controller.update_holdings(holdings, returns_db)
    
    # Test 1: Try to buy highly correlated banking stock (GARAN)
    res_1 = controller.check_exposure_limit("GARAN", garan_ret)
    print("GARAN Order Check (Banking Sector Concentration):")
    print(f"  Authorized: {res_1['authorized']} | Status: {res_1['status']} | {res_1['message']}")
    
    # Test 2: Try to buy uncorrelated stock (Ereğli Iron & Steel)
    eregl_ret = np.random.normal(-0.0002, 0.018, days)
    res_2 = controller.check_exposure_limit("EREGL", eregl_ret)
    print("\nEREGL Order Check (Diversification Target):")
    print(f"  Authorized: {res_2['authorized']} | Status: {res_2['status']} | {res_2['message']}")
