# -*- coding: utf-8 -*-
"""
Institutional-Grade Quantitative Trading Architecture
Phase 1: Level 2 (L2) Order Book Depth & Spoofing Detector
"""

import numpy as np
from typing import List, Dict, Tuple, Any

class L2OrderBookAnalyzer:
    def __init__(self, depth_levels: int = 10, spoof_threshold_ratio: float = 2.5):
        """
        Initialize Level 2 depth and order cancellation analyzer.
        
        :param depth_levels: Number of bids/asks to analyze (usually 10).
        :param spoof_threshold_ratio: Cancel-to-trade volume ratio indicating fake liquidity.
        """
        self.depth_levels = depth_levels
        self.spoof_threshold = spoof_threshold_ratio
        
        # Track previous states to detect extreme volume cancellations (spoofing)
        self.prev_bids_qty: Dict[str, np.ndarray] = {}
        self.prev_asks_qty: Dict[str, np.ndarray] = {}

    def calculate_imbalance(self, bids_price: List[float], bids_qty: List[float], 
                            asks_price: List[float], asks_qty: List[float], 
                            levels: int = 5) -> float:
        """
        Calculate Level 2 Order Book Volume Imbalance (VOI) up to n levels.
        Formula:
            Imbalance = (Sum(BidQty) - Sum(AskQty)) / (Sum(BidQty) + Sum(AskQty))
            
        Values close to +1 indicate strong buying pressure, -1 indicates heavy selling.
        """
        b_qty = np.array(bids_qty[:levels])
        a_qty = np.array(asks_qty[:levels])
        
        bid_sum = np.sum(b_qty)
        ask_sum = np.sum(a_qty)
        
        total_depth = bid_sum + ask_sum
        if total_depth == 0:
            return 0.0
            
        return float((bid_sum - ask_sum) / total_depth)

    def calculate_micro_price(self, bids_price: List[float], bids_qty: List[float], 
                              asks_price: List[float], asks_qty: List[float]) -> float:
        """
        Calculate the Micro-Price (Volume-Weighted Midpoint).
        More robust than mid-price because it adjusts for size weight, preventing execution gaming.
        Formula:
            MicroPrice = (BidPrice * AskQty + AskPrice * BidQty) / (BidQty + AskQty)
        """
        best_bid_p = bids_price[0]
        best_bid_q = bids_qty[0]
        best_ask_p = asks_price[0]
        best_ask_q = asks_qty[0]
        
        denom = best_bid_q + best_ask_q
        if denom == 0:
            return float((best_bid_p + best_ask_p) / 2.0)
            
        return float((best_bid_p * best_ask_q + best_ask_p * best_bid_q) / denom)

    def detect_spoofing(self, symbol: str, bids_price: List[float], bids_qty: List[float], 
                        asks_price: List[float], asks_qty: List[float]) -> Dict[str, Any]:
        """
        Detect spoofing and ghost liquidity in real time.
        Compares current bids/asks quantities with previous frames.
        If large volumes are placed close to the spread and suddenly canceled without a trade execution,
        it signals market manipulation (spoofing).
        """
        curr_bids = np.array(bids_qty[:self.depth_levels])
        curr_asks = np.array(asks_qty[:self.depth_levels])
        
        spoof_alerts = []
        is_manipulated = False
        manipulation_side = None
        
        # Check Bids Spoofing (Buy side orders getting pulled)
        if symbol in self.prev_bids_qty:
            prev_b = self.prev_bids_qty[symbol]
            # Detect where volume dropped significantly
            diff = prev_b - curr_bids
            for lvl, val in enumerate(diff):
                if val > 0 and (val / max(curr_bids[lvl], 1e-5)) > self.spoof_threshold:
                    spoof_alerts.append(f"BID_LEVEL_{lvl}_SPOOF: Large order pull of {val:.2f} units.")
                    is_manipulated = True
                    manipulation_side = 'BUY_PRESSURE_FAKE'

        # Check Asks Spoofing (Sell side orders getting pulled)
        if symbol in self.prev_asks_qty:
            prev_a = self.prev_asks_qty[symbol]
            diff = prev_a - curr_asks
            for lvl, val in enumerate(diff):
                if val > 0 and (val / max(curr_asks[lvl], 1e-5)) > self.spoof_threshold:
                    spoof_alerts.append(f"ASK_LEVEL_{lvl}_SPOOF: Large order pull of {val:.2f} units.")
                    is_manipulated = True
                    manipulation_side = 'SELL_PRESSURE_FAKE'

        # Update cache
        self.prev_bids_qty[symbol] = curr_bids
        self.prev_asks_qty[symbol] = curr_asks
        
        best_bid = bids_price[0]
        best_ask = asks_price[0]
        spread = best_ask - best_bid
        
        return {
            "symbol": symbol,
            "is_manipulated": is_manipulated,
            "manipulation_side": manipulation_side,
            "alerts": spoof_alerts,
            "spread": float(spread),
            "spread_pct": float(spread / best_ask * 100),
            "micro_price": self.calculate_micro_price(bids_price, bids_qty, asks_price, asks_qty),
            "voi_l5": self.calculate_imbalance(bids_price, bids_qty, asks_price, asks_qty, levels=5)
        }

    def validate_sentiment_against_orderbook(self, sentiment_score: float, 
                                             bids_price: List[float], bids_qty: List[float], 
                                             asks_price: List[float], asks_qty: List[float],
                                             levels: int = 5) -> Dict[str, Any]:
        """
        Cross-validates incoming breaking news sentiment against the real-time Level 2 depth.
        Detects 'Sell the News' or 'Stop Hunt' traps where market makers absorb retail flows.
        """
        voi = self.calculate_imbalance(bids_price, bids_qty, asks_price, asks_qty, levels)
        
        is_trap = False
        trap_type = "NONE"
        
        # 1. Sell the News Trap (Bullish news, but massive ask walls absorbing buyers)
        if sentiment_score > 0.6 and voi < -0.6:
            is_trap = True
            trap_type = "SELL_THE_NEWS_TRAP"
            
        # 2. Buy the Panic Trap (Bearish news, but massive bid walls absorbing sellers)
        elif sentiment_score < -0.6 and voi > 0.6:
            is_trap = True
            trap_type = "BUY_THE_DIP_TRAP"
            
        return {
            "sentiment_score": sentiment_score,
            "order_book_imbalance": float(voi),
            "is_trap": is_trap,
            "trap_type": trap_type,
            "action": "BLOCK_TRADE" if is_trap else "PROCEED"
        }

# ====================================================================
# Unit Test Sandbox
# ====================================================================
if __name__ == "__main__":
    analyzer = L2OrderBookAnalyzer(depth_levels=5, spoof_threshold_ratio=2.0)
    
    # Frame 1: Normal Depth
    sym = "THYAO.IS"
    b_prices = [320.0, 319.5, 319.0, 318.5, 318.0]
    b_qtys   = [10000.0, 15000.0, 20000.0, 25000.0, 30000.0]
    a_prices = [320.5, 321.0, 321.5, 322.0, 322.5]
    a_qtys   = [8000.0, 12000.0, 18000.0, 22000.0, 27000.0]
    
    res1 = analyzer.detect_spoofing(sym, b_prices, b_qtys, a_prices, a_qtys)
    print("Frame 1 Result:")
    print(f"Spread: {res1['spread']} | MicroPrice: {res1['micro_price']:.2f} | VOI L5: {res1['voi_l5']:.4f}")
    
    # Frame 2: Huge spoofing cancel at Bid Level 1 (Index 0 goes from 10k to 1k)
    b_qtys_t2 = [1000.0, 15000.0, 20000.0, 25000.0, 30000.0]
    res2 = analyzer.detect_spoofing(sym, b_prices, b_qtys_t2, a_prices, a_qtys)
    print("\nFrame 2 Result (After sudden cancellation):")
    print(f"Is Manipulated: {res2['is_manipulated']}")
    print(f"Manipulation Side: {res2['manipulation_side']}")
    print(f"Alerts: {res2['alerts']}")

    # Frame 3: Sentiment Trap Testing
    # Extremely positive news (0.9), but order book is heavily skewed to asks (selling pressure)
    a_qtys_trap = [80000.0, 120000.0, 18000.0, 22000.0, 27000.0]  # Massive ask walls
    b_qtys_trap = [1000.0, 1500.0, 2000.0, 2500.0, 3000.0]        # Weak bids
    
    trap_res = analyzer.validate_sentiment_against_orderbook(
        sentiment_score=0.9,
        bids_price=b_prices, bids_qty=b_qtys_trap,
        asks_price=a_prices, asks_qty=a_qtys_trap
    )
    print("\nFrame 3 Result (Sentiment Trap Analysis):")
    print(f"News Sentiment: {trap_res['sentiment_score']}")
    print(f"Order Book Imbalance: {trap_res['order_book_imbalance']:.2f}")
    print(f"Is Trap Detected: {trap_res['is_trap']} ({trap_res['trap_type']}) -> Action: {trap_res['action']}")
