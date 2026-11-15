# -*- coding: utf-8 -*-
"""
Institutional-Grade Quantitative Trading Architecture
Phase 3: Mathematical Expectation (Expected Value) Trade Filter
"""

from typing import Dict, Any, Optional
import math

class ExpectedValueFilter:
    def __init__(self, min_ev_threshold: float = 0.0, default_roundtrip_cost_pct: float = 0.0):
        """
        Initialize Expected Value (EV) block filter.
        
        :param min_ev_threshold: Minimum EV (in percentage) required to authorize transaction.
        :param default_roundtrip_cost_pct: Default BIST commission + BSMV + slippage round-trip cost (%).
        """
        self.min_ev = min_ev_threshold
        self.default_cost = default_roundtrip_cost_pct

    @staticmethod
    def _is_finite(val: float) -> bool:
        return isinstance(val, (int, float)) and not isinstance(val, bool) and math.isfinite(val)

    def evaluate_trade(self, win_probability: float, target_profit_pct: float, 
                       stop_loss_pct: float, roundtrip_cost_pct: Optional[float] = None) -> Dict[str, Any]:
        """
        Calculate mathematical expectancy of the trade net of BIST round-trip costs.
        Formula:
            EV_gross = (p * TargetProfit) - ((1 - p) * StopLoss)
            EV_net   = EV_gross - c
            R/R_net  = max(0, TargetProfit - c) / (StopLoss + c)
        """
        raw_cost = self.default_cost if roundtrip_cost_pct is None else roundtrip_cost_pct
        if not (
            self._is_finite(win_probability)
            and 0.0 <= float(win_probability) <= 1.0
            and self._is_finite(target_profit_pct)
            and self._is_finite(stop_loss_pct)
            and self._is_finite(raw_cost)
            and float(raw_cost) >= 0.0
        ):
            return {
                "expected_value_pct": 0.0,
                "gross_expected_value_pct": 0.0,
                "roundtrip_cost_pct": 0.0,
                "win_probability": 0.0,
                "loss_probability": 0.0,
                "reward_to_risk": 0.0,
                "net_reward_to_risk": 0.0,
                "is_authorized": False,
                "status": "INVALID_INPUT",
                "message": "Trade blocked. Invalid, negative cost, or non-finite input parameters."
            }

        p = float(win_probability)
        loss_prob = 1.0 - p
        
        # Absolute stop loss and profit magnitudes must be positive
        stop_magnitude = abs(float(stop_loss_pct))
        profit_magnitude = abs(float(target_profit_pct))
        c = float(raw_cost)
        
        # Expected value formula (single cost deduction on net EV)
        gross_ev_pct = (p * profit_magnitude) - (loss_prob * stop_magnitude)
        expected_value_pct = gross_ev_pct - c
        
        # Gross and Net Risk/Reward ratios
        r_r_ratio = profit_magnitude / (stop_magnitude if stop_magnitude != 0 else 1e-10)
        net_denom = stop_magnitude + c
        net_r_r_ratio = max(0.0, profit_magnitude - c) / (net_denom if net_denom != 0 else 1e-10)
        
        is_authorized = expected_value_pct > self.min_ev
        
        return {
            "expected_value_pct": float(expected_value_pct),
            "gross_expected_value_pct": float(gross_ev_pct),
            "roundtrip_cost_pct": float(c),
            "win_probability": float(p),
            "loss_probability": float(loss_prob),
            "reward_to_risk": float(r_r_ratio),
            "net_reward_to_risk": float(net_r_r_ratio),
            "is_authorized": is_authorized,
            "status": "AUTHORIZED" if is_authorized else "BLOCKED_NEGATIVE_EXPECTATION",
            "message": "Trade execution cleared." if is_authorized else f"Trade blocked. Math expected return ({expected_value_pct:.2f}%) is below threshold."
        }

# ====================================================================
# Expected Value Sandbox
# ====================================================================
if __name__ == "__main__":
    ev_filter = ExpectedValueFilter(min_ev_threshold=0.5) # Minimum +0.5% EV required
    
    # Scenario 1: High win rate, moderate gains, tight stops
    # 60% win prob, 5% profit target, 3% stop loss
    res_1 = ev_filter.evaluate_trade(win_probability=0.60, target_profit_pct=5.0, stop_loss_pct=3.0)
    print("Scenario 1 (High Win Rate):")
    print(f"  EV: {res_1['expected_value_pct']:.2f}% | Authorized: {res_1['is_authorized']} | {res_1['message']}")
    
    # Scenario 2: Low win rate, large gains, wide stops
    # 35% win prob, 10% profit target, 6% stop loss
    res_2 = ev_filter.evaluate_trade(win_probability=0.35, target_profit_pct=10.0, stop_loss_pct=6.0)
    print("\nScenario 2 (High Reward/Risk, low probability):")
    print(f"  EV: {res_2['expected_value_pct']:.2f}% | R/R: {res_2['reward_to_risk']:.2f}:1 | Authorized: {res_2['is_authorized']} | {res_2['message']}")
    
    # Scenario 3: Poor setup (Negative Expectation)
    # 45% win prob, 3% profit target, 4% stop loss
    res_3 = ev_filter.evaluate_trade(win_probability=0.45, target_profit_pct=3.0, stop_loss_pct=4.0)
    print("\nScenario 3 (Poor Setup):")
    print(f"  EV: {res_3['expected_value_pct']:.2f}% | Authorized: {res_3['is_authorized']} | {res_3['message']}")
