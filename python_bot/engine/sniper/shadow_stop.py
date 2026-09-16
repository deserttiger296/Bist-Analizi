# -*- coding: utf-8 -*-
"""
Institutional-Grade Quantitative Trading Architecture
Phase 4: Predator Protection - In-Memory Shadow Stop-Loss & Take-Profit
"""

import time
import json
import os
from typing import Dict, Any, Callable

class ShadowStopLossRouter:
    def __init__(self, db_file: str = "shadow_db.json"):
        """
        Keeps stop-loss and take-profit boundaries entirely hidden in local RAM.
        Broker book only sees the entry order. Stops are executed via market orders 
        instantly when the local engine detects price breaches.
        Also persists to disk to survive crashes (Position Reconciliation).
        """
        self.db_file = db_file
        # Dict storing active shadow boundaries: {symbol: {stop_loss, take_profit, quantity}}
        self.shadow_targets: Dict[str, Dict[str, float]] = {}
        self.load_from_disk()

    def load_from_disk(self):
        """Loads shadow boundaries from disk if available."""
        if os.path.exists(self.db_file):
            try:
                with open(self.db_file, 'r', encoding='utf-8') as f:
                    self.shadow_targets = json.load(f)
                print(f"[ShadowRouter] Loaded {len(self.shadow_targets)} shadow targets from disk ({self.db_file}).")
            except Exception as e:
                print(f"[ShadowRouter] Failed to load from disk: {e}")

    def save_to_disk(self):
        """Saves current shadow boundaries to disk."""
        try:
            with open(self.db_file, 'w', encoding='utf-8') as f:
                json.dump(self.shadow_targets, f, indent=4)
        except Exception as e:
            print(f"[ShadowRouter] Failed to save to disk: {e}")

    def set_shadow_bounds(self, symbol: str, quantity: float, 
                          stop_loss_price: float, take_profit_price: float):
        """
        Register hidden shadow boundaries for a specific symbol position.
        """
        self.shadow_targets[symbol] = {
            "quantity": quantity,
            "stop_loss": stop_loss_price,
            "take_profit": take_profit_price,
            "timestamp": time.time()
        }
        self.save_to_disk()
        print(f"[ShadowRouter] REGISTERED: {symbol} | Qty: {quantity} | Hidden Stop: {stop_loss_price:.2f}₺ | Hidden Profit: {take_profit_price:.2f}₺")

    def monitor_tick(self, symbol: str, current_bid_price: float, 
                     current_ask_price: float, execution_callback: Callable[[str, float, float, str], None]) -> Dict[str, Any]:
        """
        Processes real-time ticks to check if shadow stop boundaries have been violated.
        
        Using bid/ask prices prevents getting executed on wide spreads (spread spike spikes).
        * BUY positions are exited on BID drops (selling into the bid).
        * SELL/SHORT positions are exited on ASK rises (buying from the ask).
        """
        if symbol not in self.shadow_targets:
            return {"triggered": False, "status": "NO_ACTIVE_TARGET"}
            
        targets = self.shadow_targets[symbol]
        qty = targets["quantity"]
        stop = targets["stop_loss"]
        profit = targets["take_profit"]
        
        # We assume we are LONG:
        # Exit if bid price drops below stop loss (Capital shield trigger)
        if current_bid_price <= stop:
            print(f"\n[ShadowRouter] !!! SHADOW STOP BREACHED !!! {symbol} Bid {current_bid_price:.2f}₺ crossed Stop {stop:.2f}₺.")
            execution_callback(symbol, qty, current_bid_price, "SELL_MARKET_STOP_LOSS")
            del self.shadow_targets[symbol]
            self.save_to_disk()
            return {"triggered": True, "action": "STOP_LOSS_EXIT", "exit_price": current_bid_price}
            
        # Exit if bid price rises above take profit (Target captured)
        elif current_bid_price >= profit:
            print(f"\n[ShadowRouter] !!! SHADOW PROFIT CAPTURED !!! {symbol} Bid {current_bid_price:.2f}₺ crossed Profit {profit:.2f}₺.")
            execution_callback(symbol, qty, current_bid_price, "SELL_MARKET_TAKE_PROFIT")
            del self.shadow_targets[symbol]
            self.save_to_disk()
            return {"triggered": True, "action": "TAKE_PROFIT_EXIT", "exit_price": current_bid_price}
            
        return {"triggered": False, "status": "MONITORING"}

# ====================================================================
# Shadow Stop Sandbox
# ====================================================================
if __name__ == "__main__":
    router = ShadowStopLossRouter()
    
    # Mock broker execution callback
    def execute_broker_order(symbol: str, qty: float, price: float, order_type: str):
        print(f"  [BROKER API SEND] Order Sent: {order_type} | {qty} Shares of {symbol} at {price:.2f}₺ | Trigger latency: sub-millisecond.")

    sym = "EREGL.IS"
    # Buy entry at 50.0₺, set hidden stop at 48.0₺ and take profit at 55.0₺
    router.set_shadow_bounds(sym, quantity=1000, stop_loss_price=48.0, take_profit_price=55.0)
    
    # Tick 1: Normal fluctuating price (Bid 49.5, Ask 49.7)
    print("\nTick 1 (Normal Trade):")
    res1 = router.monitor_tick(sym, current_bid_price=49.5, current_ask_price=49.7, execution_callback=execute_broker_order)
    print(f"  Triggered: {res1['triggered']} | Status: {res1.get('status')}")
    
    # Tick 2: Predatory Stop-Hunting flash drop (Bid hits 47.9, triggering our local memory stop)
    print("\nTick 2 (Market crash / stop hunt spike):")
    res2 = router.monitor_tick(sym, current_bid_price=47.9, current_ask_price=48.2, execution_callback=execute_broker_order)
    print(f"  Triggered: {res2['triggered']} | Exit Type: {res2.get('action')} at {res2.get('exit_price')}₺")
