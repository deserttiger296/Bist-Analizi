# -*- coding: utf-8 -*-
"""
Institutional-Grade Quantitative Trading Architecture
Phase 3: Quantitative Risk Management & Kelly Position Sizing
"""

from typing import Dict, Any

class KellySizingEngine:
    def __init__(self, default_fraction: float = 0.5, max_position_pct: float = 0.15):
        """
        Initialize Kelly Position Sizing Engine.
        
        :param default_fraction: Fractional Kelly scaling multiplier (e.g., 0.5 = Half-Kelly). Protects against over-betting.
        :param max_position_pct: Hard ceiling for any single trade allocation (e.g., max 15% of total capital).
        """
        self.fraction = default_fraction
        self.max_cap = max_position_pct

    def calculate_allocation(self, win_probability: float, reward_to_risk: float, 
                             total_capital: float, current_cash: float,
                             sentiment_score: float = 0.0, trade_direction: str = "LONG") -> Dict[str, Any]:
        """
        Calculate optimal allocation size using the Fractional Kelly Criterion,
        adjusted dynamically by real-time market sentiment.
        
        Formula:
            f* = (p * (R + 1) - 1) / R
            Where:
                p = win_probability
                R = reward_to_risk ratio
                
        Fractional adjustment:
            f_scaled = f* * fraction
        """
        p = win_probability
        R = reward_to_risk
        
        if R <= 0:
            return {
                "recommended_pct": 0.0,
                "recommended_capital": 0.0,
                "status": "REJECTED",
                "reason": "Reward-to-risk ratio is zero or negative."
            }

        # 1. Calculate Raw Kelly
        raw_kelly = (p * (R + 1.0) - 1.0) / R
        
        # If raw Kelly is negative or zero, do not take the trade
        if raw_kelly <= 0:
            return {
                "recommended_pct": 0.0,
                "recommended_capital": 0.0,
                "status": "REJECTED",
                "reason": "Negative mathematical expectation (Edge is negative)."
            }

        # 2. Scale with Fractional Kelly multiplier
        scaled_kelly = raw_kelly * self.fraction
        
        # 3. Sentiment-Driven Risk Brake (Fren Mekanizması)
        sentiment_penalty = 1.0
        if trade_direction == "LONG" and sentiment_score < -0.3:
            # High algorithmic edge, but breaking news is panic-selling
            sentiment_penalty = 0.5  # Cut position by 50%
        elif trade_direction == "SHORT" and sentiment_score > 0.3:
            # Shorting against extremely bullish news
            sentiment_penalty = 0.5
            
        scaled_kelly = scaled_kelly * sentiment_penalty

        # 4. Apply Hard Portfolio Concentration Ceiling (Max Capital Limit)
        final_allocation_pct = min(scaled_kelly, self.max_cap)
        
        # 4. Convert percentage to absolute capital allocation
        target_capital = total_capital * final_allocation_pct
        
        # 5. Check if we have enough cash reserves
        status = "APPROVED"
        if target_capital > current_cash:
            target_capital = current_cash
            final_allocation_pct = target_capital / total_capital
            status = "APPROVED_CASH_LIMITED"
            
        return {
            "raw_kelly_pct": float(raw_kelly * 100),
            "sentiment_penalty_applied": sentiment_penalty < 1.0,
            "recommended_pct": float(final_allocation_pct * 100),
            "recommended_capital": float(target_capital),
            "status": status,
            "reason": "Successful sizing" if status == "APPROVED" else "Sized down to fit available cash reserves or sentiment."
        }

# ====================================================================
# Kelly Sizing Sandbox
# ====================================================================
if __name__ == "__main__":
    sizing_engine = KellySizingEngine(default_fraction=0.5, max_position_pct=0.15) # Half-Kelly, max 15% cap
    
    total_cap = 1000000.0 # 1,000,000₺
    free_cash = 250000.0   # 250,000₺ cash
    # Trade A: 55% Win Prob, 2.0 Risk/Reward (Extremely High Edge, Neutral Sentiment)
    res_a = sizing_engine.calculate_allocation(
        win_probability=0.55, reward_to_risk=2.0, 
        total_capital=total_cap, current_cash=free_cash,
        sentiment_score=0.1, trade_direction="LONG"
    )
    print("Trade A Allocation (High Edge, Normal Sentiment):")
    print(f"  Raw Kelly: {res_a['raw_kelly_pct']:.2f}% | Recommended: {res_a['recommended_pct']:.2f}% | Status: {res_a['status']}")
    
    # Trade B: Same math edge as A, but Extreme Negative Sentiment
    res_b = sizing_engine.calculate_allocation(
        win_probability=0.55, reward_to_risk=2.0, 
        total_capital=total_cap, current_cash=free_cash,
        sentiment_score=-0.85, trade_direction="LONG"  # Macro trend is good, but immediate panic news
    )
    print("\nTrade B Allocation (High Edge, Panic Sentiment Break):")
    print(f"  Recommended: {res_b['recommended_pct']:.2f}% | Penalty Applied: {res_b['sentiment_penalty_applied']}")
    
    # Trade C: 65% Win Prob, 3.0 Risk/Reward (Cash Constrained)
    res_c = sizing_engine.calculate_allocation(
        win_probability=0.65, reward_to_risk=3.0, 
        total_capital=total_cap, current_cash=80000.0
    )
    print("\nTrade C Allocation (Cash Constrained):")
    print(f"  Recommended: {res_c['recommended_pct']:.2f}% | Capital: {res_c['recommended_capital']:.2f}₺ | Status: {res_c['status']}")
