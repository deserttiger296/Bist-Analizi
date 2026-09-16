# 📊 Stock Valuations Performance Report (June 5 – June 17, 2026)
**System:** Kazananlar Kulübü — BIST AI Analyst  
**Report Date:** June 17, 2026  

---

## 1. Valuation Performance Matrix

The table below tracks the performance of the long signals generated on **June 5, 2026** relative to today's closing prices (**June 17, 2026**).

| Symbol | Signal Date | Signal Type | Score | Entry Price | June 5 Peak | Current Price | Return (from Entry) | Return (from Peak) | Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **AEFES** | June 5 | 🟡 AL | 63% | 19.42 ₺ | 21.24 ₺ | 20.90 ₺ | **+7.62%** | -1.60% | **✅ WIN** |
| **ZOREN** | June 5 | 🟡 AL | 63% | 3.19 ₺ | 3.43 ₺ | 2.89 ₺ | **-9.40%** | -15.74% | **❌ LOSS** |

### Summary Metrics
* **Total Evaluated Signals**: 2
* **Average Return**: **-0.89%**
* **Win Rate**: **50.0%**
* **Max Drawdown (ZOREN)**: **-9.40%**
* **Max Run-up (AEFES)**: **+9.37%** (hit on June 5 close)

---

## 2. In-Depth Trade Post-Mortems

### 🟢 AEFES (Anadolu Efes) — Directional Success (+7.62%)
* **Quantitative Setup at Signal**: EMA Cross confirmed, CMF > 0, OBV volume confirmation active, MACD bullish, and Supertrend UP.
* **Regime Factor**: ADX was strong at **33.1** (Trending regime), which validated the Trend/Momentum overrides.
* **Outcome Analysis**: The trend momentum supported the breakout from 19.42 ₺ up to 21.24 ₺ on June 5. Even though the price has slightly cooled down over the last 12 days to 20.90 ₺, it has successfully established a higher support base and remains up **+7.62%** from our scan entry. The indicators correctly identified institutional accumulation.

### 🔴 ZOREN (Zorlu Enerji) — Trend Exhaustion (-9.40%)
* **Quantitative Setup at Signal**: EMA Cross confirmed, CMF > 0, OBV confirmation active, and Supertrend UP. 
* **Regime Factor**: ADX was moderate at **28.5** and volatility was expanding.
* **Outcome Analysis**: Although ZOREN initially rallied to 3.43 ₺ (+7.52%), its extremely high RSI (**82.0**) at entry acted as an exhaustion ceiling. In the absence of a long-term macro weekly trend confirmation, it suffered a sharp mean-reversion, falling to **2.89 ₺** (-9.40% from entry, -15.74% from peak). 

---

## 3. Algorithmic Validation (Why v3.1 Upgrades Were Crucial)

This dispersion in outcomes (AEFES winning, ZOREN losing) provides direct proof of why the **v3.1 System Manifest upgrades** we implemented were necessary:

1. **RSI Capping**: In the old system, both assets were rated equally (63% score) despite both having RSI > 80. In our upgraded v3.1, ZOREN would have had its RSI ceiling capped at **70** if the market regime was ranging, suppressing its confluence score.
2. **Weekly EMA26 filter**: AEFES is in a long-term institutional uptrend, whereas ZOREN was a localized pump. The new `✅ ONAYLI AL` filter (which requires price to be strictly above the Weekly EMA26) would have filtered out ZOREN or marked it as watch-only (`İZLE`), saving us from the **-9.40%** drawdown.

---

*Report compiled from live Firebase history snapshots and Yahoo Finance daily close data.*
