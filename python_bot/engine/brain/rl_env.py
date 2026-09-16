# -*- coding: utf-8 -*-
"""
Institutional-Grade Quantitative Trading Architecture
Phase 2: Reinforcement Learning (RL) Trading Environment
"""

import numpy as np
from typing import Tuple, Dict, Any

# Dynamic Gym/Gymnasium Import Protection (Robust Fallback System)
try:
    import gymnasium as gym
    from gymnasium import spaces
    ENV_BASE = gym.Env
except ImportError:
    # Standard Python class interface in case gym is not installed
    class MockSpaces:
        class Discrete:
            def __init__(self, n: int):
                self.n = n
            def sample(self): return np.random.randint(0, self.n)
        class Box:
            def __init__(self, low: float, high: float, shape: Tuple[int, ...], dtype=None):
                self.low = low
                self.high = high
                self.shape = shape
                self.dtype = dtype
            def sample(self): return np.random.uniform(self.low, self.high, self.shape)
            
    class DummyEnv:
        pass
        
    gym = MockSpaces()
    spaces = MockSpaces
    ENV_BASE = DummyEnv

class QuantTradingEnv(ENV_BASE):
    """
    State-of-the-Art Reinforcement Learning Trading Environment.
    Optimized for high-volatility stock scanning.
    """
    def __init__(self, prices: np.ndarray, features: np.ndarray, 
                 initial_balance: float = 100000.0, max_drawdown_penalty: float = 2.0):
        """
        :param prices: Array of closing prices (chronological)
        :param features: Feature-engineered matrix (observations), shape (N, feature_dim)
        :param initial_balance: Account starting capital in TL/USD
        :param max_drawdown_penalty: Risk multiplier scaling drawdowns to penalize rewards
        """
        super().__init__()
        self.prices = prices
        self.features = features
        self.initial_balance = initial_balance
        self.drawdown_penalty = max_drawdown_penalty
        
        self.n_samples = len(prices)
        self.feature_dim = features.shape[1]
        
        # Action Space: 0 = Buy/Long, 1 = Hold, 2 = Sell/Close
        if hasattr(spaces, 'Discrete'):
            self.action_space = spaces.Discrete(3)
            self.observation_space = spaces.Box(
                low=-np.inf, high=np.inf, shape=(self.feature_dim + 3,), dtype=np.float32
            )
        else:
            self.action_space = spaces.Discrete(3)
            self.observation_space = spaces.Box(-np.inf, np.inf, (self.feature_dim + 3,))

        self.reset()

    def reset(self, seed: int = None, options: Dict[str, Any] = None) -> Tuple[np.ndarray, Dict[str, Any]]:
        """
        Reset the trading environment to start of time-series.
        """
        self.balance = self.initial_balance
        self.shares_held = 0.0
        self.portfolio_value = self.initial_balance
        self.peak_value = self.initial_balance
        self.max_drawdown = 0.0
        self.current_step = 0
        
        # Track historical records for metric/Sharpe calculations
        self.portfolio_history = [self.initial_balance]
        
        obs = self._get_observation()
        info = {"portfolio_value": self.portfolio_value}
        return obs, info

    def _get_observation(self) -> np.ndarray:
        """
        Build observation state.
        Combines technical features with agent's portfolio metadata (holdings, balance).
        """
        feature_row = self.features[self.current_step]
        holding_state = np.array([
            self.shares_held * self.prices[self.current_step] / self.portfolio_value, # Holdings ratio
            self.balance / self.portfolio_value,                                    # Cash ratio
            (self.portfolio_value - self.initial_balance) / self.initial_balance    # Return ratio
        ])
        return np.concatenate([feature_row, holding_state]).astype(np.float32)

    def step(self, action: int) -> Tuple[np.ndarray, float, bool, bool, Dict[str, Any]]:
        """
        Perform a single time-series trading step.
        """
        current_price = self.prices[self.current_step]
        prev_portfolio_value = self.portfolio_value

        # --- Execute Actions ---
        if action == 0:  # BUY/LONG (Allocate 95% of cash)
            if self.balance > 10.0:
                shares_to_buy = (self.balance * 0.95) / current_price
                self.shares_held += shares_to_buy
                self.balance -= (shares_to_buy * current_price)
                
        elif action == 2: # SELL/CLOSE (Liquidate all shares)
            if self.shares_held > 0.0:
                self.balance += (self.shares_held * current_price)
                self.shares_held = 0.0

        # Action == 1 is HOLD (No transactions)

        # --- Update Portfolio State ---
        self.current_step += 1
        new_price = self.prices[self.current_step]
        self.portfolio_value = self.balance + (self.shares_held * new_price)
        self.portfolio_history.append(self.portfolio_value)

        # Calculate trailing Drawdown
        self.peak_value = max(self.peak_value, self.portfolio_value)
        drawdown = (self.peak_value - self.portfolio_value) / self.peak_value
        self.max_drawdown = max(self.max_drawdown, drawdown)

        # --- Calculate Reward (Sharpe Ratio + Drawdown Penalty) ---
        step_return = (self.portfolio_value - prev_portfolio_value) / prev_portfolio_value
        
        # Calculate returns volatility for trailing Sharpe estimation
        # NOTE: original quant-core version sliced numerator/denominator windows
        # inconsistently (-10: vs -11:-1), a 9-vs-10 length mismatch that raised
        # a broadcast ValueError. Both slices now come from the same trailing
        # 11-value window so np.diff (10 values) lines up with its 10 bases.
        if len(self.portfolio_history) >= 11:
            trailing_window = np.array(self.portfolio_history[-11:])
            recent_returns = np.diff(trailing_window) / trailing_window[:-1]
        else:
            recent_returns = np.array([0.0])
        returns_std = np.std(recent_returns) if len(recent_returns) > 1 and np.std(recent_returns) > 0 else 0.01
        
        # Sharpe estimation
        sharpe_reward = (step_return - 0.0) / (returns_std + 1e-10)
        
        # Total Reward combines return velocity with max drawdown risk penalties
        reward = float(sharpe_reward - (self.drawdown_penalty * drawdown))

        # Check if out of time or bankrupt
        terminated = self.current_step >= self.n_samples - 1
        truncated = self.portfolio_value < (self.initial_balance * 0.3) # Terminate if 70% lost
        
        obs = self._get_observation()
        info = {
            "portfolio_value": self.portfolio_value,
            "max_drawdown": self.max_drawdown,
            "shares_held": self.shares_held
        }

        return obs, reward, terminated, truncated, info

# ====================================================================
# Reinforcement Learning Environment Sandbox
# ====================================================================
if __name__ == "__main__":
    np.random.seed(42)
    n_days = 200
    mock_prices = 100.0 + np.cumsum(np.random.normal(0.5, 3.0, n_days))
    
    # 5 indicator columns
    mock_features = np.random.normal(0.0, 1.0, (n_days, 5))
    
    env = QuantTradingEnv(prices=mock_prices, features=mock_features, initial_balance=50000.0)
    obs, info = env.reset()
    
    print("Environment Reset Completed.")
    print(f"Observation Vector Shape: {obs.shape}")
    print(f"Starting Capital: {info['portfolio_value']:.2f} TL")
    
    # Run a random trading loop for 10 steps
    print("\nRunning Random Action Agent Sim:")
    for step_num in range(1, 11):
        action = env.action_space.sample() # Random actions
        obs, reward, term, trunc, info = env.step(action)
        print(f"  Step {step_num} | Action: {action} | Portfolio: {info['portfolio_value']:.2f}₺ | MaxDD: {info['max_drawdown']*100:.2f}% | Reward: {reward:.4f}")
        if term or trunc:
            break
