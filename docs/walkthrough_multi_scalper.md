# Day Trading Scalper: Multi-Strategy Engine

The Intraday Scalper Engine has been successfully upgraded from a single, static breakout condition into a dynamic, **Multi-Strategy Architecture**. The AI now scans BIST 30 assets simultaneously across three distinct mathematical models, allowing it to capture a wider variety of intraday alpha.

## ⚙️ The Strategies

The system analyzes real-time 5-minute (5m) candle data against the following discrete strategies:

### 1. 🔵 Momentum Ignition
The refined version of our core strategy, designed to ride high-volume surges in the direction of the daily trend.
- **Trigger Condition:** `Price > VWAP`
- **Volume:** `RVOL > 1.3` (Tier 2 minimum)
- **Momentum:** `RSI Momentum > +2.0` (Speed of RSI change)
- **Ceiling:** `RSI < 75` (Avoids buying the absolute top of a pump)

### 2. 🟣 Deep VWAP Reversion
A highly specialized mean-reversion strategy designed to "buy the dip" during panic sell-offs. It looks for severe capitulation that is mathematically likely to snap back to the mean (VWAP).
- **Deviation:** `VWAP Deviation < -2.5%` (Deep oversold plunge)
- **Capitulation:** `RSI < 30` (Extreme oversold)
- **The Turn:** `RSI Momentum > 0` (The RSI has stopped falling and is curling up)
- **Volume:** `RVOL > 1.0` (Volume is stepping in to absorb the selling pressure)

### 3. 🟠 Squeeze Breakout
A volatility-expansion strategy based on Bollinger Bands. It detects periods where price action is tightly compressed and trades the explosive breakout.
- **Compression:** `Bollinger Bandwidth < 2.0%` (Extreme tightness)
- **The Break:** `Current Price > Upper Bollinger Band` (Breakout)
- **Confirmation:** `RVOL > 1.5` (Volume explosion confirms the squeeze is firing)

---

## 🖥️ UI Updates: Day-Desk
The `Day-Desk` terminal has been updated to fully support this new architecture. 

In the **Canlı Sinyaller (Live Signals)** table, you will now see a **Strateji** column. When the engine fires a signal to Firestore, it tags the exact strategy that triggered it. The UI displays this as a distinct, color-coded badge:
- `[MOMENTUM IGNITION]` (Blue)
- `[VWAP REVERSION]` (Purple)
- `[SQUEEZE BREAKOUT]` (Amber)

This allows you to instantly know *why* the AI fired the signal and adjust your position sizing and risk management accordingly (e.g., you might take quick profits on a Reversion trade, but hold a Squeeze Breakout longer).
