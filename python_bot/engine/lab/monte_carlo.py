# -*- coding: utf-8 -*-
"""
Institutional-Grade Quantitative Trading Architecture
Phase 5: Portfolio Stress Testing - Monte Carlo Simulator
"""

import numpy as np
from typing import Dict, Any, List

class MonteCarloSimulator:
    def __init__(self, n_simulations: int = 10000, initial_capital: float = 100000.0):
        """
        Initialize the Monte Carlo Stress Testing simulator.
        
        :param n_simulations: Number of random trade sequence runs (default 10,000 for institutional-level confidence).
        :param initial_capital: Starting bankroll for simulations.
        """
        self.n_sims = n_simulations
        self.start_cap = initial_capital

    def run_simulation(self, trade_returns_pct: List[float], leverage: float = 1.0, 
                       ruin_threshold_pct: float = 0.50) -> Dict[str, Any]:
        """
        Run vectorized Monte Carlo simulations to construct risk probability profiles.
        
        :param trade_returns_pct: List of percentage returns from historical trades (e.g., [0.05, -0.02, 0.08, -0.04])
        :param leverage: Portfolio leverage multiplier.
        :param ruin_threshold_pct: Threshold fraction of capital indicating bankruptcy/ruin (e.g., 50% loss = 0.50)
        """
        returns = np.array(trade_returns_pct) * leverage
        n_trades = len(returns)
        
        if n_trades == 0:
            return {"ruin_probability": 0.0, "max_drawdown_99pct": 0.0, "status": "NO_TRADES_TO_SIMULATE"}
            
        # Vectorized generation of random trade sequence indices (10,000 runs x N trades)
        # Using replacement bootstrap sampling
        np.random.seed(99)
        random_indices = np.random.choice(n_trades, size=(self.n_sims, n_trades), replace=True)
        sim_returns = returns[random_indices] # Shape (10000, n_trades)
        
        # Calculate cumulative multiplier paths for all 10,000 runs simultaneously
        # P_t = P_0 * CumProd(1 + r_t)
        equity_curves = self.start_cap * np.cumprod(1.0 + sim_returns, axis=1)
        # Insert starting capital column at index 0
        equity_curves = np.hstack((np.full((self.n_sims, 1), self.start_cap), equity_curves))
        
        # Calculate trailing peak equity curves
        running_peaks = np.maximum.accumulate(equity_curves, axis=1)
        
        # Calculate drawdown curves across all runs
        drawdowns = (running_peaks - equity_curves) / running_peaks
        max_drawdowns_per_run = np.max(drawdowns, axis=1)
        
        # Calculate final equity at end of simulation for each run
        final_equity_per_run = equity_curves[:, -1]
        
        # Calculate Ruin Probability (Capital drops below threshold)
        ruin_value = self.start_cap * (1.0 - ruin_threshold_pct)
        # Check if any equity path crossed below ruin threshold during its life
        crossed_ruin = np.any(equity_curves <= ruin_value, axis=1)
        ruin_probability = float(np.sum(crossed_ruin) / self.n_sims)
        
        # Extract Quantiles
        max_dd_mean = float(np.mean(max_drawdowns_per_run))
        max_dd_95 = float(np.percentile(max_drawdowns_per_run, 95))
        max_dd_99 = float(np.percentile(max_drawdowns_per_run, 99))
        
        final_eq_mean = float(np.mean(final_equity_per_run))
        final_eq_5th = float(np.percentile(final_equity_per_run, 5))
        final_eq_95th = float(np.percentile(final_equity_per_run, 95))

        return {
            "n_simulations": self.n_sims,
            "ruin_probability_pct": ruin_probability * 100,
            "max_drawdown_mean_pct": max_dd_mean * 100,
            "max_drawdown_95pct": max_dd_95 * 100,
            "max_drawdown_99pct": max_dd_99 * 100,
            "final_equity_mean": final_eq_mean,
            "final_equity_5pct_worst_case": final_eq_5th,
            "final_equity_95pct_best_case": final_eq_95th,
            "status": "SUCCESS"
        }

# ====================================================================
# Monte Carlo Sandbox
# ====================================================================
if __name__ == "__main__":
    simulator = MonteCarloSimulator(n_simulations=10000, initial_capital=100000.0) # 100,000₺
    
    # Simulate a successful quantitative strategy with a mathematical edge:
    # 55% win rate, average win +3.0%, average loss -2.0%
    np.random.seed(5)
    trade_count = 100
    
    historical_trade_returns = []
    for _ in range(trade_count):
        if np.random.random() < 0.55:
            historical_trade_returns.append(0.030) # +3% win
        else:
            historical_trade_returns.append(-0.020) # -2% loss

    # Run simulations
    res = simulator.run_simulation(historical_trade_returns, leverage=1.0, ruin_threshold_pct=0.40) # Ruin = 40% loss
    
    print("=== MONTE CARLO STRESS TEST RESULTS (10,000 Trials) ===")
    print(f"Ruin/Bankruptcy Probability (Target -40% loss): {res['ruin_probability_pct']:.2f}%")
    print(f"Expected Average Max Drawdown: {res['max_drawdown_mean_pct']:.2f}%")
    print(f"95% Confidence Maximum Drawdown: {res['max_drawdown_95pct']:.2f}%")
    print(f"99% Confidence (Worst-Case Black Swan) Max Drawdown: {res['max_drawdown_99pct']:.2f}%")
    print(f"Mean Portfolio Final Value: {res['final_equity_mean']:.2f}₺")
    print(f"5th Percentile (Worst 5% Runs Outcome): {res['final_equity_5pct_worst_case']:.2f}₺")
    print(f"95th Percentile (Best 5% Runs Outcome): {res['final_equity_95pct_best_case']:.2f}₺")
