# -*- coding: utf-8 -*-
"""
Institutional-Grade Quantitative Trading Architecture
Phase 4: Advanced Order Execution Router (TWAP & VWAP)
"""

import time
import random
import logging
from typing import Dict, Any, List

# Configure institutional-grade logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("ExecutionRouter")

class AdvancedExecutionRouter:
    def __init__(self):
        self.circuit_breaker_active = False
        self.circuit_breaker_threshold = 5.0  # Default threshold 5% drop

    def check_circuit_breaker(self, portfolio_drop_pct: float):
        """
        Monitors portfolio drops. If the drop exceeds the threshold,
        activates the circuit breaker to freeze/block new orders.
        """
        if portfolio_drop_pct > self.circuit_breaker_threshold:
            self.circuit_breaker_active = True
            logger.warning(f"CIRCUIT BREAKER ACTIVATED! Portfolio drop ({portfolio_drop_pct}%) exceeded threshold ({self.circuit_breaker_threshold}%).")
        else:
            self.circuit_breaker_active = False
            logger.info("Circuit Breaker relaxed. Trading operations normal.")

    def generate_twap_schedule(self, total_shares: float, duration_minutes: int, 
                               interval_seconds: int = 10) -> List[Dict[str, Any]]:
        """
        Slice a large parent block order linearly over time (Time-Weighted Average Price).
        Randomizes order sizes slightly to prevent reverse-engineering and detection by HFT predatory algorithms.
        """
        if self.circuit_breaker_active:
            logger.error("TWAP execution blocked: Circuit Breaker is active!")
            return []

        if total_shares <= 0:
            raise ValueError(f"TWAP execution failed: total_shares must be strictly positive, got {total_shares}")
        if duration_minutes <= 0:
            raise ValueError(f"TWAP execution failed: duration_minutes must be > 0, got {duration_minutes}")
        if interval_seconds <= 0:
            raise ValueError("TWAP execution failed: interval_seconds must be > 0")

        total_intervals = int((duration_minutes * 60) / interval_seconds)
        if total_intervals == 0:
            raise ValueError("TWAP execution failed: total_intervals evaluated to 0 (duration too short relative to interval)")
        
        base_size = total_shares / total_intervals
        
        schedule = []
        shares_allocated = 0.0
        
        for i in range(total_intervals):
            # Introduce +/- 15% random noise to size and +/- 2s noise to timing to mask HFT footprint
            noise_factor = random.uniform(0.85, 1.15)
            child_size = base_size * noise_factor
            
            # Ensure we do not over-allocate on the last step
            if i == total_intervals - 1:
                child_size = total_shares - shares_allocated
                
            child_size = round(max(child_size, 1.0), 2)
            shares_allocated += child_size
            
            schedule.append({
                "slice_index": i + 1,
                "shares_to_execute": child_size,
                "delay_seconds": int(interval_seconds + random.uniform(-2, 2)),
                "type": "TWAP_CHILD_ORDER"
            })
            
            if shares_allocated >= total_shares:
                break
                
        return schedule

    def generate_vwap_schedule(self, total_shares: float, duration_intervals: int, 
                               historical_volume_profile: List[float]) -> List[Dict[str, Any]]:
        """
        Volume-Weighted Average Price (VWAP) execution algorithm.
        Distributes orders matching the historical U-shaped intraday volume distribution curve 
        (e.g., executing heavily at the market open and close, and slicing lightly during mid-day).
        
        :param historical_volume_profile: Array of volume percentages for each interval (must sum up to 1.0).
        """
        if self.circuit_breaker_active:
            logger.error("VWAP execution blocked: Circuit Breaker is active!")
            return []

        if total_shares <= 0:
            raise ValueError(f"VWAP execution failed: total_shares must be strictly positive, got {total_shares}")
        if duration_intervals <= 0:
            raise ValueError(f"VWAP execution failed: duration_intervals must be > 0, got {duration_intervals}")
        if not historical_volume_profile:
            raise ValueError("VWAP execution failed: historical_volume_profile is empty")

        # Normalize profile just in case it doesn't sum exactly to 1.0
        profile_sum = sum(historical_volume_profile)
        if profile_sum <= 0:
            raise ValueError(f"VWAP execution failed: volume profile sum is non-positive ({profile_sum})")
            
        normalized_profile = [v / profile_sum for v in historical_volume_profile]
        
        schedule = []
        shares_allocated = 0.0
        n_intervals = min(duration_intervals, len(normalized_profile))
        
        for i in range(n_intervals):
            volume_pct = normalized_profile[i]
            child_size = total_shares * volume_pct
            
            # Randomize slightly to avoid predictable orders
            child_size = child_size * random.uniform(0.90, 1.10)
            
            if i == n_intervals - 1:
                child_size = total_shares - shares_allocated
                
            child_size = round(max(child_size, 1.0), 2)
            shares_allocated += child_size
            
            schedule.append({
                "interval_index": i + 1,
                "shares_to_execute": child_size,
                "volume_participation_pct": round(volume_pct * 100, 2),
                "type": "VWAP_CHILD_ORDER"
            })
            
        return schedule

# ====================================================================
# Execution Router Sandbox
# ====================================================================
if __name__ == "__main__":
    router = AdvancedExecutionRouter()
    
    parent_order_shares = 50000.0 # Large BIST buy block (e.g., THYAO)
    
    # Test Circuit Breaker
    logger.info("=== TESTING CIRCUIT BREAKER ===")
    router.check_circuit_breaker(6.0) # This should activate the circuit breaker
    blocked_plan = router.generate_twap_schedule(parent_order_shares, 5, 30)
    logger.info(f"Blocked plan slices: {len(blocked_plan)}")
    
    router.check_circuit_breaker(2.0) # Reset circuit breaker
    
    # Test 1: Generate TWAP execution plan over 5 minutes with 30-second slices
    logger.info("=== TWAP EXECUTION ROUTING PLAN ===")
    twap_plan = router.generate_twap_schedule(
        total_shares=parent_order_shares, 
        duration_minutes=5, 
        interval_seconds=30
    )
    for order in twap_plan[:5]:
        logger.info(f"Slice {order['slice_index']} | Execute: {order['shares_to_execute']:.2f} Shares | Next delay: {order['delay_seconds']}s")
    logger.info(f"... total slices: {len(twap_plan)}")

    # Test 2: Generate VWAP execution plan matching standard U-shaped volume curve (5 intervals)
    # Market Open (30%), Mid-Day (10%, 10%, 10%), Market Close (40%)
    u_shaped_vol_curve = [0.30, 0.10, 0.10, 0.10, 0.40]
    
    logger.info("=== VWAP EXECUTION ROUTING PLAN ===")
    vwap_plan = router.generate_vwap_schedule(
        total_shares=parent_order_shares, 
        duration_intervals=5, 
        historical_volume_profile=u_shaped_vol_curve
    )
    for idx, order in enumerate(vwap_plan, 1):
        logger.info(f"Interval {idx} | Target volume: {order['volume_participation_pct']}% | Execute: {order['shares_to_execute']:.2f} Shares")
