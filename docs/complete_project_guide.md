# 🏛️ Kazananlar Kulübü — BIST Analyst (v3.1) Unified System Guide

This is the master system guide for the **Kazananlar Kulübü (BIST Analyst)** platform. It documents the core architecture, quantitative models, data ingestion planes, mathematical formulas, daytrading scalper engines, database structures, self-calibration logic, and developer setup.

---

## Table of Contents
1. [System Architecture & Compute Planes](#1-system-architecture--compute-planes)
2. [Data Ingestion Plane & Redundancy](#2-data-ingestion-plane--redundancy)
3. [Market Regime Detection](#3-market-regime-detection)
4. [Quantitative Scoring System (Daily Swing Engine)](#4-quantitative-scoring-system-daily-swing-engine)
5. [Signal Recommendation Ladder & Fakeout Gates](#5-signal-recommendation-ladder--fakeout-gates)
6. [Intraday Scalper Engine (Day-Desk)](#6-intraday-scalper-engine-day-desk)
7. [Risk Management & Position Sizing](#7-risk-management--position-sizing)
8. [Walk-Forward Self-Calibration Pipeline](#8-walk-forward-self-calibration-pipeline)
9. [Database Synchronization Model](#9-database-synchronization-model)
10. [Automation Cron Scheduler API](#10-automation-cron-scheduler-api)
11. [Developer Guide & CI/CD Pipeline](#11-developer-guide--cicd-pipeline)

---

## 1. System Architecture & Compute Planes

BIST Analyst is structured as a multi-tier quantitative trading and analysis system. The frontend is built on **Next.js 15 (React 19)**, and the backend leverages serverless **Google Cloud/Firebase** tools.

```mermaid
graph TD
    %% Client Layer
    subgraph Client Layer [Client Interface - Real-time UX]
        UI[BIST Scanner Panel]
        DayDesk[Day-Desk Live Terminal]
        Watchlist[Personal Tracker Panel]
    end

    %% API Layer
    subgraph API Gateway [Next.js SSR Gateway]
        API_Scan[/api/bist/scan]
        API_Cron[/api/bist/cron/scan]
        API_Scalper[/api/bist/cron/scalper]
        API_PnL[/api/bist/pnl]
    end

    %% Quant Plane
    subgraph Compute Plane [Quantitative & ML Engine]
        Quant[bist.ts / indicators.ts]
        Scalper[scalperEngine.ts]
        Calibrator[calibrationEngine.ts]
        Vertex[Vertex AI - Gemini Core]
    end

    %% Data & Messaging
    subgraph Data & Sync Plane [Database & Messaging]
        Firestore[(Firestore NoSQL)]
        DataConnect[(Data Connect PostgreSQL)]
        FCM{FCM Cloud Messaging}
    end

    %% External Inputs
    subgraph External Inputs [Data Feeds & Scrapers]
        BiQ[BiQuote Real-Time Feed]
        YF[Yahoo Finance API]
        IS[İş Yatırım Scraper]
        KAP[KAP Announcement Scraper]
    end

    %% Connections
    UI <-->|onSnapshot Real-time Sub| Firestore
    DayDesk <-->|onSnapshot Live Signal Sub| Firestore
    Watchlist -->|Fast On-Demand Scan| API_Scan
    
    API_Scan --> Quant
    API_Cron --> Quant
    API_Scalper --> Scalper
    
    Quant -->|Real-time Ticks| BiQ
    Quant -->|1D Close History| YF
    Quant -->|Scrape Fundamentals| IS
    Quant -->|Scrape Announcements| KAP
    
    Scalper -->|5m Chart Data| YF
    
    Quant --> Calibrator
    Calibrator --> Vertex
    
    Quant -->|Sync Docs| Firestore
    Quant -->|Sync Rows| DataConnect
    Scalper -->|Sync Signals| Firestore
    
    Firestore --> FCM
    FCM -->|Push Alerts| UI
```

---

## 2. Data Ingestion Plane & Redundancy

To avoid signal starvation due to delayed data, the system runs a **Dual-Engine Ingestion Plane** with three layers of fallback redundancy:

1. **Primary Live Engine (BiQuote.io API)**: Pulls real-time tick prices from Matriks/BiQuote feeds. If the tick is invalid or does not contain a numeric price, the system triggers the fallback.
2. **Secondary Engine (Yahoo Finance API)**: Falls back to Yahoo Finance Spark/Chart feeds for daily, weekly, and monthly candle aggregates.
   * **v3.1 Volume Integrity Verification Gate**: If the raw volume array returned contains more than **10% zero values**, the data is flagged as corrupted. The system aborts and falls back to Twelve Data or İş Yatırım.
3. **Redundancy Fallbacks**: 
   * **Twelve Data API**: Acts as the first secondary fallback for historical prices.
   * **İş Yatırım Scraper**: Public HTML scraper to fetch raw historical price vectors.
   * **Timestamp Normalization**: Real-time tick injection values (BiQuote) are normalized to start-of-day timestamps on daily bars to eliminate ghost bars and moving average corruption.

---

## 3. Market Regime Detection

Technical indicator signals behave differently in trending versus ranging markets. Before computing confluence scores, the system detects the market regime using **Average Directional Index (ADX)** and **Bollinger Band Width**:

* **TRENDING Regimes** (`ADX > 25` and `BB Width > Average`): High directional strength. The system applies a **1.3x multiplier** to Trend and Momentum indicator weights.
* **RANGING Regimes** (`ADX <= 25` and `BB Width <= Average`): Low directional strength. The system applies a **1.3x multiplier** to Mean-Reversion and Structure indicators (RSI extremes, Bollinger Lower Band touches, Pivot Support levels).
* **KRİZ (Crisis/Extreme Volatility) Regimes**: Identified via HMM model analysis of rolling 20-day returns. The Kelly capital sizing engine freezes all allocations ($0\%$) to preserve capital.

---

## 4. Quantitative Scoring System (Daily Swing Engine)

Every scanned BIST asset is evaluated using **22 distinct technical parameters** across 4 categories: Trend, Momentum, Volume, and Structure.

### The v3.1 Composite Scoring Formula
Instead of requiring a rigid threshold per category, the system uses a weighted composite percentage:

$$\text{Composite Score} = (0.35 \times \text{Trend}) + (0.25 \times \text{Momentum}) + (0.25 \times \text{Volume}) + (0.15 \times \text{Structure})$$

### Scoring Weights Matrix

| Category | Indicator Signal | Base Weight | Regime Adjustment | Trigger Condition |
| :--- | :--- | :---: | :--- | :--- |
| **Trend** | EMA Cross | 10 | 1.3x on Trending | `EMA 5 > EMA 20` |
| **Trend** | Price Above EMA 20 | 6 | 1.3x on Trending | `Close > EMA 20` |
| **Trend** | Ichimoku Cloud | 5 | 1.3x on Trending | `Price > Span A` & `Price > Span B` & `Tenkan > Kijun` |
| **Trend** | EMA Ribbon | 4 | 1.3x on Trending | EMA Ribbon index >= 2 (Bullish alignment) |
| **Trend** | 2-Day EMA 21 | 10 | - | `Close > 2-Day EMA 21` |
| **Trend** | 3-Day EMA 21 | 12 | - | `Close > 3-Day EMA 21` |
| **Momentum** | MACD Histogram | 7 | - | `MACD Histogram > 0` |
| **Momentum** | MACD Cross | 4 | - | `MACD > MACD Signal` |
| **Momentum** | Stochastic | 5 | - | `Stoch K > Stoch D` and `Stoch K < 80` |
| **Momentum** | CCI Positive | 3 | - | `CCI > 0` and `CCI < 200` |
| **Momentum** | RSI Bullish Zone | 4 | - | `RSI > 40` and `RSI < 70` |
| **Momentum** | RSI Bullish Divergence | 8 | - | Bullish divergence detected |
| **Momentum** | MACD Bullish Divergence| 6 | - | MACD divergence detected |
| **Volume** | CMF Positive | 8 | - | `Chaikin Money Flow (20) > 0` |
| **Volume** | OBV Confirmation | 6 | - | `OBV` is rising while price is stable or accumulating |
| **Volume** | VWAP Above | 5 | - | `Close > VWAP` |
| **Volume** | Volume Trend | 4 | - | Current Volume > 1.5x of 10-day Average Volume |
| **Structure** | Supertrend | 5 | 1.3x on Trending | `Supertrend == UP` |
| **Structure** | Parabolic SAR | 3 | - | `SAR < Close` |
| **Structure** | ADX Strength | 5 | 1.3x on Trending | `ADX > 25` and `+DI > -DI` |
| **Structure** | Bollinger Bounce | 5 | 1.3x on Ranging | Bounces off the Lower Bollinger Band |
| **Structure** | Bollinger Squeeze | 4 | 1.3x on Ranging | Bands narrowing & `Close > BB SMA` |
| **Structure** | Near Pivot Support | 4 | 1.3x on Ranging | Close is within 2% of nearest Pivot Support |

### v3.1 Dynamic RSI Overbought Override
* **In TRENDING Regimes**: The upper RSI overbought limit is expanded from 70 **up to 85** to capture high-velocity trend momentum.
* **In RANGING Regimes**: The RSI cap returns to **70** to avoid buying local tops.

### Divergence Penalties (Critical Overrides)
To prevent holding assets during bearish reversals, the system applies direct penalties to the final confluence score:
* **RSI Bearish Divergence**: Deducts **-15%** from the score.
* **MACD Bearish Divergence**: Deducts **-10%** from the score.

---

## 5. Signal Recommendation Ladder & Fakeout Gates

The system maps the composite score and indicators into an actionable signal ladder.

```
                  ┌───────────────────────────────┐
                  │    Ingestion & Indicators     │
                  └───────────────┬───────────────┘
                                  │
                                  ▼
                        /───────────────────\
                       <  Is Stop Broken?    >
                        \───────────────────/
                                  │ No
                                  ▼
                        /───────────────────\
                       <  Is Fakeout True?   >
                        \───────────────────/
                                  │ No
                                  ▼
                        /───────────────────\
                       <   Meets Buy Gate?   >
                        \───────────────────/
                                  │ Yes
                                  ▼
                     ┌──────────────────────────┐
                     │      ✅ ONAYLI AL        │
                     │ (Bullish Weekly EMA26 &  │
                     │   Composite Score >= 65) │
                     └──────────────────────────┘
```

### Recommendation Levels

1. **✅ ONAYLI AL (Approved Buy)**: Reserved for high-probability setups.
   * **Criteria**: `Composite Score >= 65%`, price is above the **Weekly EMA 26**, no fakeout detected, and no support stops are broken.
2. **✅ GÜÇLÜ AL (Strong Buy)**: Confluence Score $\ge 70\%$ and $\ge 3$ categories confirming.
3. **🟡 AL (Buy)**: Confluence Score $\ge 55\%$ and $\ge 2$ categories confirming.
4. **🟠 İZLE (Watch)**: Confluence Score $\ge 40\%$ and $\ge 2$ categories confirming.
5. **🐳 BALİNA ALARMI (Whale Alarm)**: Volume is $>300\%$ of its 10-day average.
6. **⭐ DİP FIRSAT (Dip Opportunity)**: Bullish RSI/MACD divergence detected.
7. **⚠️ DİKKAT (Caution)**: Bearish RSI/MACD divergence detected.
8. **🔵 BEKLE (Hold)**: Confluence Score $\ge 30\%$.
9. **🔴 KAÇIN (Avoid)**: Confluence Score $< 30\%$.
10. **⚠️ BOĞA TUZAĞI (Bull Trap)**: Fakeout detected.
11. **⚠️ STOP KIRILDI (Stop Broken)**: Asset has closed below its support stops.

### Fakeout Detection Logic
The system flags a **Bull Trap** if any of the following are true:
* **Low-Volume Breakout**: Price is rising, but Volume confirmation score is $<40\%$ and CMF20 is $\le -0.05$.
* **Bearish Divergence**: Price makes higher highs while RSI/MACD make lower highs.
* **Overextension**: Price is above the Upper Bollinger Band and RSI is $\ge 75$ in a ranging market.
* **Capital Outflow**: CMF20 is $<-0.15$ and OBV is not rising.

---

## 6. Intraday Scalper Engine (Day-Desk)

The Scalper Engine operates on **5-minute bars** and scans **BIST 30** assets for high-frequency daytrading signals.

### v3.1 Tiered RVOL Sensitivity Spectrum
To prevent signal starvation on lower-volume trading days, the RVOL (Relative Volume) criteria uses a tiered scoring system:
* **Tier 1 (RVOL > 2.0)**: Scores **+40 points** (Volume Explosion).
* **Tier 2 (1.3 < RVOL <= 2.0)**: Scores **+20 points** (High Volume).
* **Tier 3 (0.8 < RVOL <= 1.3)**: Scores **+10 points** (Normal Accumulation).

The engine triggers a scalper signal if **RVOL > 1.3** (Tier 2), rather than forcing a strict 2.0 limit, while enforcing VWAP and RSI speed gates.

### Core Daytrading Strategies

#### 1. Momentum Ignition
Captures explosive momentum in the direction of the trend.
* **Trigger Conditions**: 
  * `Close > VWAP`
  * `RSI < 75`
  * `RSI Momentum (Speed) > 2.0`
  * `RVOL > 1.3`

#### 2. Deep VWAP Reversion
An oversold mean-reversion strategy to buy localized panic dips.
* **Trigger Conditions**:
  * `VWAP Deviation < -2.5%`
  * `RSI < 30`
  * `RSI Momentum > 0`
  * `RVOL > 1.0`

#### 3. Volatility Squeeze Breakout
Enters trades immediately upon volatility breakout from consolidation bands.
* **Trigger Conditions**:
  * Bollinger Bandwidth $< 2.0\%$ (tight squeeze)
  * `Close > Upper Bollinger Band`
  * `RVOL > 1.5`

---

## 7. Risk Management & Position Sizing

Institutional capital preservation is built directly into signal generation.

* **Dynamic Trailing Stop Loss**: Calculated using Average True Range (ATR):
  $$\text{Stop Loss} = \text{Price} - (1.5 \times \text{ATR}_{14})$$
* **Ribbon Guardrails**: The stop loss is bounded by the minimum of **EMA 21** and **EMA 26** in native currency. If the price closes below this ribbon, a exit signal (`⚠️ STOP KIRILDI`) is triggered.
* **Position Sizing (Fractional Kelly)**: Positions are calculated based on model win rates ($p$) and risk-reward ratios ($b$):
  $$\text{Kelly Fraction} = p - \frac{1 - p}{b}$$
  The final allocation size is clamped between **2% and 25%** of capital.
* **Regime Scaling**:
  * `TRENDING`: 100% of the calculated Kelly size is deployed.
  * `RANGING`: Scaled down to 70% of Kelly.
  * `KRİZ (Crisis)`: Frozen ($0\%$) to keep capital in cash.

---

## 8. Walk-Forward Self-Calibration Pipeline

The system uses a closed-loop machine learning calibration engine (`calibrationEngine.ts`) to continuously tune technical weights based on market results.

```
   ┌──────────────────────┐
   │ Daily Scan Run       │
   └──────────┬───────────┘
              │
              ▼
   ┌──────────────────────┐
   │ Save Firestore Snap  │
   └──────────┬───────────┘
              │
              ▼ (T+5 Days Later)
   ┌──────────────────────┐
   │ Classify Outcomes    │
   │ (TP / FP / FN)       │
   └──────────┬───────────┘
              │
              ▼
   ┌──────────────────────┐
   │ Pearson Correlation  │
   │ & Gemini AI Review   │
   └──────────┬───────────┘
              │
              ▼
   ┌──────────────────────┐
   │ Deploy Updated       │
   │ Weights to Production│
   └──────────────────────┘
```

### 1. T+5 Outcome Classification
Every day trade or swing signal is tracked for 5 market days (T+5) and classified:
* **TRUE_POSITIVE**: `AL` or `GÜÇLÜ AL` signals where the price reached the **+3% profit target** without hitting the ATR stop loss.
* **FALSE_POSITIVE**: Signals where the price hit the **stop loss** or dropped **>3%** before reaching the target.
* **FALSE_NEGATIVE**: `KAÇIN` or `BEKLE` signals where the stock subsequently rallied **>5%**.

### 2. Pearson Correlation & AI Weight Tuning
At the end of the week, the calibrator runs a two-step feedback loop:
1. **Pearson Correlation**: Computes correlation coefficients between individual indicator activations and the forward returns.
2. **Gemini AI Weight Update**: The calibration engine formats the correlation results and outcome logs, sending them to **Gemini 2.0 Flash**. The AI adjusts indicator weights:
   * Highly correlated with True Positives: Rewarded up to **+20%**.
   * Correlated with False Positives: Penalized by **-20%**.
   * The new weight matrix is written to Firestore (`system_config/indicator_weights`) and applied in the next scan.

---

## 9. Database Synchronization Model

We use a **Dual-Redundancy Database Architecture** to combine real-time reactivity with query capabilities.

* **Firestore (NoSQL)**: Real-time data plane. Dashboards and daytrading screens connect to Firestore collections via live WebSockets (`onSnapshot`). This ensures sub-second updates of prices, signals, and alerts.
* **Firebase Data Connect (PostgreSQL)**: Analytical data plane. Stores relational history of every scan, backtest run, PnL record, and calibration iteration. This allows running complex SQL queries, building custom PnL reports, and conducting backtests without impacting client read capacity.

---

## 10. Automation Cron Scheduler API

Autonomous background scheduling is driven by QStash (Upstash) triggering Next.js server routes:

* **`/api/bist/cron/scan`** (Runs every 15 minutes, Monday-Friday, 10:00 - 18:00 BIST time):
  Triggers a full market scan, updates indicators, saves results to Firestore, logs rows in PostgreSQL, and pushes breakout notifications via FCM.
* **`/api/bist/cron/scalper`** (Runs every 5 minutes during market hours):
  Scans BIST 30 stocks on 5m charts. Detects Momentum, Reversion, or Squeeze entries, and updates the Live Signals panel.
* **`/api/bist/cron/calibrate`** (Runs weekly):
  Triggers the Walk-Forward calibration loop, evaluates T+5 outcomes, runs Pearson correlation calculations, invokes Gemini AI, and commits the updated weights to Firestore.
* **`/api/bist/cron/smart-stop`** (Runs daily, EOD):
  Computes ATR and trailing stop-loss coordinates for all active signals, saving the new guardrails to the databases.

---

## 11. Developer Guide & CI/CD Pipeline

### Local Environment Setup

1. **Clone & Setup**:
   ```bash
   cd vscode - ai robot/bist-analyst-app
   npm install
   ```

2. **Run Development Server**:
   ```bash
   npm run dev
   ```

3. **Production Build Compilation**:
   ```bash
   npm run build
   ```

### CI/CD Deployment Pipeline
The project uses GitHub Actions to automate deployments to Firebase. The workflow configuration is located in:
* **Workflow File**: [.github/workflows/firebase-deploy.yml](file:///C:/Users/ogun/Downloads/vscode%20-%20ai%20robotKK/vscode%20-%20ai%20robot/bist-analyst-app/.github/workflows/firebase-deploy.yml)

The workflow executes the following pipeline upon push to `main` or `master` branches:
1. Checks out the code to the runner workspace.
2. Configures Node.js (v22) and restores the npm cache.
3. Installs dependencies using `npm ci`.
4. Enables the Firebase Webframeworks experiment.
5. Runs the production build and deploys to Firebase using `firebase-tools`:
   ```yaml
   npx firebase-tools deploy --force --non-interactive --token "$FIREBASE_TOKEN"
   ```

---

*This guide serves as the single source of truth for the Kazananlar Kulübü BIST Analyst platform architecture.*
