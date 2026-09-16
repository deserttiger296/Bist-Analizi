# 🔬 Rigorous Statistical Audit & Backtest Report

This audit evaluates the reliability of the **BIST AI Analyst Swing Engine** indicators generated on **June 5, 2026**, against performance as of **June 17, 2026** ($N = 90$ audited stocks). It resolves historical contradictions, executes statistical significance testing, backtests CMF out-of-sample, and quantifies the system's net edge against the BIST 100 benchmark.

## 1. Resolution of Contradictions

### 🔊 The Volume Score Paradox (14.8 vs. 14.8)
* **Contradiction**: In previous reports, the average volume score was identical for winners and losers (14.8), yet the text claimed "Winners showed significantly higher relative volume confirmation."
* **Resolution**: The volume score represents the *relative volume (RVOL) at the exact moment of signal generation (June 5)*. Because the Swing Engine filters for breakout signals, **both cohorts necessarily had high relative volume at entry** (thus yielding the identical 14.8 average). Re-computing the raw averages confirms they are indeed identical: **14.81** for winners and **14.44** for losers. The previous written conclusion claiming volume score differentiated the groups was mathematically false and represented an interpretive error.

### 📈 The Trending Regime Ratio Conflict (61.5% vs. 69.2%)
* **Contradiction**: The table showed losers had a higher trending ratio (69.2%) than winners (61.5%), but the text claimed the opposite.
* **Resolution**: Re-compiling the raw data shows that on June 5, 2026, **61.5%** of the successful cohort was flagged as being in a "TRENDING" regime, compared to **66.7%** of the losing cohort. The previous table was inverted during data processing. The actual data shows that the trending regime ratio is virtually indistinguishable between the two cohorts and does not serve as a reliable filter.

## 2. Statistical Significance Testing

Given $N_1 = 26$ successes and $N_2 = 27$ failures, we conducted Welch's t-tests (for continuous variables) and two-proportion z-tests (for proportions) to isolate real signal from noise at $\alpha = 0.05$:

| Technical Indicator | Winning Cohort Average | Losing Cohort Average | Test Statistic | P-Value | Statistically Significant? ($\alpha = 0.05$) |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **RSI (14)** | 69.81 | 69.87 | $t = -0.017$ | $p = 0.9868$ | ❌ **No** (Statistically identical) |
| **ADX (Trend Strength)** | 32.86 | 30.55 | $t = 0.592$ | $p = 0.5540$ | ❌ **No** (Statistically identical) |
| **Chaikin Money Flow (CMF)**| 0.0791 | 0.0272 | $t = 1.089$ | $p = 0.2759$ | ❌ **No** ($p > 0.05$, likely noise in this sample) |
| **Volume Score** | 14.81 | 14.44 | $t = 0.180$ | $p = 0.8568$ | ❌ **No** (Identical at signal generation) |
| **OBV Rising Ratio** | 65.4% | 66.7% | $Z = -0.099$ | $p = 0.9215$ | ❌ **No** (Statistically identical) |
| **Trending Regime Ratio**| 61.5% | 66.7% | $Z = -0.389$ | $p = 0.6971$ | ❌ **No** (Statistically identical) |

> [!WARNING]
> **Conclusion of Significance Audit**: In this June 5–17 sample, **not a single technical indicator difference reaches statistical significance**. Even Chaikin Money Flow (CMF), which showed the largest raw gap, yields a p-value of **0.276**. With a sample size of only 26 stocks per group, these differences are mathematically indistinguishable from random noise.

## 3. Out-of-Sample Backtest: Is Chaikin Money Flow (CMF) Validated?

To determine if CMF holds up as a predictive signal, we backtested the **CMF > 0.05** filter out-of-sample across three independent historical periods. The results are detailed below:

| Historical Backtest Period | Base Signals (N) | Base Return | Base Win Rate | CMF > 0.05 Signals (N) | CMF Filtered Return | CMF Filtered Win Rate | Net Performance Change |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **Period 1** | 35 | 3.17% | 65.7% | 11 | 4.51% | 54.5% | +1.34% Return |
| **Period 2** | 56 | 4.79% | 85.7% | 38 | 4.92% | 84.2% | +0.14% Return |
| **Period 3** | 37 | 5.96% | 78.4% | 15 | 5.97% | 80.0% | +0.02% Return |

> [!IMPORTANT]
> **Backtest Conclusion**: The CMF > 0.05 filter **failed to demonstrate robust or consistent out-of-sample predictive power**. While it marginally increased the average return across the three periods (+1.34%, +0.14%, +0.01%), it degraded the win rate in Period 1 (-11.2%) and Period 2 (-1.5%), while drastically reducing the available trading sample size (cutting signals by 60-70% in each period). This severe sample reduction increases the standard error and trading volatility, confirming that the filter does not provide a robust, repeatable net edge.

## 4. Net Expectancy & Benchmarking against BIST 100 Index

To evaluate whether the BIST AI Analyst provides any true value, we computed the aggregate return across all **90** stocks (including successes, failures, and neutrals) and compared it to holding the BIST 100 Index ($XU100.IS$):

* **Average System Return (All 90 stocks)**: **-0.19%**
* **BIST 100 Index ($XU100.IS$) Return**: **5.45%**
* **Net System Alpha (Expectancy vs. Index)**: **-5.64%**
* **One-Sample t-test vs. Index**: $t = -4.414$, $p = 0.0000$ (df = 89)

> [!CAUTION]
> **Expectancy Analysis**: The average return of all system recommendations (-0.19%) **statistically underperforms the BIST 100 index return (5.45%)**. The t-test yields a p-value of **0.0000**, confirming that the system has **zero positive expectancy or edge over a simple buy-and-hold index strategy** during this window (and in fact underperformed it significantly).

## 5. Strategic Recommendations and Next Steps

1. **Halt Live Scaling or Parameter Enforcements**: Since no indicator (including CMF or volume score) has demonstrated statistically significant out-of-sample predictive value, do not hardcode these values as filters in live trading.
2. **Acknowledge Small-Sample Limitations**: Avoid publishing attribution reports with small samples ($N < 100$) without reporting standard errors and confidence intervals, as they suffer from severe hindsight bias.
3. **Shift focus to Portfolio Regimes**: Rather than attempting to find single-indicator filters, focus on macro regime detection (e.g., ADX/HMM trend regimes) to scale capital in or out of the market as a whole, rather than trying to filter individual breakout setups.
