# Scalper Engine Multi-Strategy Expansion Plan

Currently, the Intraday Scalper Engine runs a single "Momentum Ignition" strategy. To make the platform a true professional day-trading tool, we need to transition to a **Multi-Strategy Architecture**. This will allow the engine to detect different market micro-structures (e.g., panic sell-offs, volatility compressions) simultaneously.

## User Review Required
> [!IMPORTANT]
> Please review the three proposed day-trading strategies below. Are these the types of setups you want to trade? Do you have any specific threshold preferences for them?

## Open Questions
- Do you want to add SHORT (sell-short) signals for intraday trading, or should the engine remain LONG-only (spot buying) for now?

## Proposed Changes

### 1. Multi-Strategy Architecture (`scalperEngine.ts`)
#### [MODIFY] [scalperEngine.ts](file:///C:/Users/ogun/Downloads/vscode%20-%20ai%20robotKK/vscode%20-%20ai%20robot/bist-analyst-app/src/lib/quant/scalperEngine.ts)
- Update `ScalperSignal` interface to include `strategyName: string`.
- Import `bollingerBands` from our `indicators.ts`.
- Refactor the evaluation loop to test the 5-minute bars against **three distinct strategies**. If any strategy passes, a signal is emitted.

#### Strategy 1: Momentum Ignition (Existing, Refined)
- **Concept:** Catching high-volume trend continuation.
- **Trigger:** `Price > VWAP` AND `RVOL > 1.3` AND `RSI Momentum > 2.0` AND `RSI < 75`.

#### Strategy 2: Deep VWAP Reversion (Dip Buying)
- **Concept:** Buying extreme panic sell-offs that are statistically likely to snap back to the VWAP mean.
- **Trigger:** 
  - `Price < VWAP` by at least `-2.5%` (Deep deviation).
  - `RSI < 30` (Extreme oversold).
  - `RSI Momentum > 0` (The knife has stopped falling and is curling up).
  - `RVOL > 1.0` (Volume is stepping in to buy the dip).

#### Strategy 3: Volatility Squeeze Breakout
- **Concept:** Trading the explosion out of a tight consolidation range.
- **Trigger:** 
  - Bollinger Bands are tight (Bandwidth < 2%).
  - The current 5m candle closes *above* the Upper Bollinger Band.
  - `RVOL > 1.5` (Strong volume confirms the breakout).

### 2. UI Updates (`day-desk/page.tsx`)
#### [MODIFY] [page.tsx](file:///C:/Users/ogun/Downloads/vscode%20-%20ai%20robotKK/vscode%20-%20ai%20robot/bist-analyst-app/src/app/(trading)/day-desk/page.tsx)
- Update the `LiveSignal` interface to expect the new `strategyName` field.
- In the "Canlı Sinyaller" table, add a small badge next to the symbol showing the `strategyName` (e.g., `[SQUEEZE]`, `[REVERSION]`, `[MOMENTUM]`) so you know exactly *why* the AI fired the signal.

## Verification Plan
### Automated Tests
- Create a test script `scratch/test-scalper-multi.ts` to simulate the three strategies on historical 5m bars and verify they trigger independently.
### Manual Verification
- Deploy to Firebase and monitor the Day-Desk during active market hours to ensure the new strategy badges appear correctly without crashing the UI.
