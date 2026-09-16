# -*- coding: utf-8 -*-
"""
Institutional-Grade Quantitative Trading Architecture
Phase 5: Walk-Forward Optimization Validation Engine
"""

import numpy as np
from typing import List, Dict, Any, Tuple

class WalkForwardOptimizer:
    def __init__(self, in_sample_pct: float = 0.70, rolling_windows: int = 5):
        """
        Initialize Walk-Forward Validation engine.
        
        :param in_sample_pct: Percentage of rolling window allocated to parameter training (e.g. 70%)
        :param rolling_windows: Number of rolling/anchored walk-forward loops
        """
        self.in_sample_pct = in_sample_pct
        self.rolling_windows = rolling_windows

    def generate_splits(self, data_length: int) -> List[Tuple[Tuple[int, int], Tuple[int, int]]]:
        """
        Generate chronological (In-Sample, Out-of-Sample) segment boundaries.
        Ensures no futuristic data leaks into the training sets.
        """
        segment_size = data_length // (self.rolling_windows + 1)
        splits = []
        
        for i in range(self.rolling_windows):
            # Anchored Walk-Forward Approach: Training set grows, testing set rolls
            train_start = 0
            train_end = int(segment_size * (i + 2) * self.in_sample_pct)
            
            test_start = train_end + 1
            test_end = min(int(segment_size * (i + 2)), data_length - 1)
            
            splits.append(((train_start, train_end), (test_start, test_end)))
            
        return splits

    def run_validation(self, prices: np.ndarray, signals: np.ndarray) -> Dict[str, Any]:
        """
        Execute Walk-Forward backtest loop.
        Trains a simple threshold parameter in-sample, and measures trading return out-of-sample.
        """
        n = len(prices)
        splits = self.generate_splits(n)
        
        results = []
        cumulative_oos_return = 1.0
        
        print(f"[WalkForwardLab] Initiating {self.rolling_windows}-Segment Out-of-Sample Walk-Forward stress testing...")
        
        for idx, ((tr_start, tr_end), (te_start, te_end)) in enumerate(splits, 1):
            # 1. Gather In-Sample (IS) Training Data
            is_prices = prices[tr_start:tr_end+1]
            is_signals = signals[tr_start:tr_end+1]
            
            # Simple Optimization: find signal threshold that yields best profit IS
            best_threshold = 0.0
            best_is_return = -9999.0
            
            for threshold_candidate in np.linspace(0.1, 0.9, 9):
                # Backtest candidate
                is_ret = self._backtest_segment(is_prices, is_signals, threshold_candidate)
                if is_ret > best_is_return:
                    best_is_return = is_ret
                    best_threshold = threshold_candidate
            
            # 2. Evaluate Out-of-Sample (OOS) Test Set (Future unseen data)
            oos_prices = prices[te_start:te_end+1]
            oos_signals = signals[te_start:te_end+1]
            
            oos_return = self._backtest_segment(oos_prices, oos_signals, best_threshold)
            cumulative_oos_return *= oos_return
            
            print(f"  Segment {idx} | IS Train: {tr_start}-{tr_end} | OOS Test: {te_start}-{te_end} | Opt Threshold: {best_threshold:.2f} | OOS Ret: {((oos_return - 1.0)*100):+.2f}%")
            
            results.append({
                "segment": idx,
                "is_optimized_threshold": float(best_threshold),
                "oos_return_pct": float((oos_return - 1.0) * 100)
            })

        return {
            "cumulative_oos_return_pct": float((cumulative_oos_return - 1.0) * 100),
            "segments_details": results,
            "status": "STRESS_TEST_COMPLETED"
        }

    def _backtest_segment(self, prices: np.ndarray, signals: np.ndarray, threshold: float) -> float:
        """
        Lightweight backtester to calculate returns over a data segment.
        """
        capital = 1.0
        position = 0.0
        
        for i in range(len(prices) - 1):
            sig = signals[i]
            curr_price = prices[i]
            next_price = prices[i+1]
            
            # Long trigger
            if sig > threshold and position == 0.0:
                position = capital / curr_price
                capital = 0.0
            # Exit trigger
            elif sig < -threshold and position > 0.0:
                capital = position * curr_price
                position = 0.0
                
        # Final value liquidation
        if position > 0.0:
            capital = position * prices[-1]
            
        return capital

# ====================================================================
# Walk-Forward Sandbox
# ====================================================================
if __name__ == "__main__":
    np.random.seed(88)
    n_days = 500
    
    # Mock stock prices with macro trending behavior
    mock_prices = 100.0 + np.cumsum(np.random.normal(0.2, 2.0, n_days))
    
    # Mock trading signal correlating loosely with direction
    direction = np.diff(mock_prices)
    mock_signals = np.zeros(n_days)
    for i in range(n_days - 1):
        # 60% chance to align signal direction correctly
        if np.random.random() < 0.60:
            mock_signals[i] = np.sign(direction[i]) * np.random.uniform(0.1, 1.0)
        else:
            mock_signals[i] = -np.sign(direction[i]) * np.random.uniform(0.1, 1.0)

    optimizer = WalkForwardOptimizer(in_sample_pct=0.75, rolling_windows=4)
    wf_results = optimizer.run_validation(mock_prices, mock_signals)
    
    print("\nWalk-Forward Stress Test Final Summary:")
    print(f"  Cumulative Out-of-Sample Return: {wf_results['cumulative_oos_return_pct']:+.2f}%")
