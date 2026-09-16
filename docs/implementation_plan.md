# System Manifest v3.1 Implementation Plan

This plan outlines the architecture and code changes required to upgrade the Kazananlar Kulübü BIST AI Analyst to the v3.1 Manifest specifications.

## User Review Required
> [!IMPORTANT]
> This upgrade modifies core trading logic and alters how scores are calculated. Please review the new Composite Score formula and the Tiered RVOL thresholds for the scalper engine.

## Proposed Changes

---

### Data Pipeline & Resilience Upgrades
#### [MODIFY] [bist.ts](file:///C:/Users/ogun/Downloads/vscode%20-%20ai%20robotKK/vscode%20-%20ai%20robot/bist-analyst-app/src/lib/bist.ts)
- **Validation Layer:** Add checks inside `getLiveBistHistoricalBars` and `fetchBulkLiveQuotes` to verify bar integrity. If placeholder data is detected (e.g., flatlines, missing volumes), trigger a retry or flag the symbol as quarantined.
- **Timestamp Normalization:** Ensure the BiQuote.io real-time tick injection aligns its date properly with the historical daily bars to prevent "duplicate bar" or "stale bar" bugs which corrupt RSI and MACD calculations at the live edge.

---

### Engine 1: Daily Swing Engine Optimization
#### [MODIFY] [bist.ts](file:///C:/Users/ogun/Downloads/vscode%20-%20ai%20robotKK/vscode%20-%20ai%20robot/bist-analyst-app/src/lib/bist.ts)
- **Composite Scoring System:** Replace the current flat percentage confidence calculation with the requested composite weights:
  `Composite = (0.35 * Trend) + (0.25 * Momentum) + (0.25 * Volume) + (0.15 * Structure)`
- **Dynamic RSI Ceilings:** 
  - Integrate the existing HMM/ADX regime state.
  - If `Regime === TRENDING` AND `ADX > 25`: Bulish RSI Zone = `[40, 85]`.
  - Else (RANGING/KRİZ): Bullish RSI Zone = `[40, 70]`.
- **Recommendation Ladder Update:** Promote a stock to `✅ ONAYLI AL` strictly when:
  - `Composite Score >= 65%`
  - `Weekly EMA26` is bullish (Price > Weekly EMA26)
  - No Fakeout/Stop Broken

---

### Engine 2: Intraday Scalper Engine
#### [MODIFY] [scalperEngine.ts](file:///C:/Users/ogun/Downloads/vscode%20-%20ai%20robotKK/vscode%20-%20ai%20robot/bist-analyst-app/src/lib/quant/scalperEngine.ts)
- **Tiered RVOL Sensitivity:** Replace the rigid `rvol > 2.0` requirement with a tiered point system:
  - **Tier 1:** RVOL > 2.0 (+40 points)
  - **Tier 2:** 1.3 < RVOL <= 2.0 (+20 points)
  - **Tier 3:** 0.8 < RVOL <= 1.3 (+10 points)
- **New Valid LONG Criteria:**
  - Price > VWAP
  - RSI < 75
  - RSI_Momentum > 2.0
  - RVOL > 1.3 (Tier 2 minimum for triggering a signal)

---

### Closed-Loop Calibration Pipeline
#### [MODIFY] [calibrationEngine.ts](file:///C:/Users/ogun/Downloads/vscode%20-%20ai%20robotKK/vscode%20-%20ai%20robot/bist-analyst-app/src/lib/calibrationEngine.ts)
- **T+5 Walk-Forward Check:** Enhance the `detectAnalysisMismatches` logic to precisely enforce the 5-day verification rules:
  - `TRUE_POSITIVE`: AL/GÜÇLÜ AL reached +3% target without hitting the stop.
  - `FALSE_POSITIVE`: Signal hit stop loss OR dropped >3%.
  - `FALSE_NEGATIVE`: KAÇIN/BEKLE signal rallied >5%.
- **Weight Calibration:** In `recalibrateWeightsAndRegime`, calculate indicator-level correlations (Pearson proxy) against the returns. Adjust baseline system weights: `> 0.15` correlation = +20% weight, `< -0.05` correlation = -20% weight.

## Verification Plan

### Automated Tests
- Run `npx tsx scratch/test-scalper-debug.ts` to verify the tiered RVOL logic yields signals without throwing errors.
- Run `npx tsx scratch/test-quant-modules.ts` to ensure regime detection and dynamic RSI work correctly.

### Manual Verification
- Rebuild the application and verify no TypeScript errors are introduced.
- Review the scanner UI to ensure `ONAYLI AL` recommendations appear based on the new `>= 65%` composite score threshold.
