# Task Tracker — Multi-Strategy Scalper Engine

## 1. Engine Refactoring (`scalperEngine.ts`)
- [x] Update `ScalperSignal` interface to include `strategyName: string`.
- [x] Import `bollingerBands` from `indicators.ts`.
- [x] Calculate Bollinger Bands on the 5m closing prices.
- [x] Implement Strategy 1: Momentum Ignition.
- [x] Implement Strategy 2: Deep VWAP Reversion.
- [x] Implement Strategy 3: Volatility Squeeze Breakout.
- [x] Refactor the evaluation block to check all three strategies independently.

## 2. UI Updates (`day-desk/page.tsx`)
- [x] Update `LiveSignal` type to include `strategyName`.
- [x] Add a visual badge in the "Canlı Sinyaller" table for the strategy name.

## 3. Verification
- [x] Run a test script to verify scalper output locally.
- [x] Verify build compiles correctly (`npx next build` — SUCCESS).
- [x] Deploy to Firebase. (SUCCESS)
