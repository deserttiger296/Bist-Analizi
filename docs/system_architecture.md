# BIST Analyst — System Architecture & Data Flow

BIST Analyst is a state-of-the-art, institutional-grade quantitative analysis and trading system designed for real-time Borsa Istanbul (BIST) stock analysis. Built on a serverless Google Cloud & Firebase stack, it combines advanced quantitative models (Kalman Filters, Pairs Trading, HMM Regimes), Machine Learning (Purged K-Fold CV), and GenAI sentiment scoring to deliver high-confidence trading signals.

---

## 1. System Architecture Overview

The system is split into three main layers: **Client Interface (Real-Time UX)**, **Serverless API & Compute (Next.js & Cloud Run)**, and the **Data & Intelligence Plane (Firebase & Vertex AI)**.

```mermaid
graph TD
    %% Frontend Layer
    subgraph Client Layer [Client Interface - Real-time UX]
        UI[BIST Scanner Panel]
        Watchlist[Personal Tracker Panel]
        CrossCheck[Confluence Settings Dock]
    end

    %% API Gateway & Backend
    subgraph API Layer [Serverless Gateway - Next.js SSR]
        API_Bg[/api/bist/background]
        API_Scan[/api/bist/scan]
        API_Cron[/api/bist/cron/scan]
    end

    %% Compute & Analytics
    subgraph Compute Plane [Quantitative & ML Engine]
        Scanner[Automated Background Scanner]
        Quant[Quantitative Engine]
        ML[ML Pipeline - Purged CV]
        Vertex[Vertex AI - Gemini Core]
    end

    %% Data Plane
    subgraph Data & Sync Plane [Database & Messaging]
        Firestore[(Firestore NoSQL Real-time)]
        DataConnect[(Data Connect PostgreSQL)]
        FCM{FCM Cloud Messaging}
    end

    %% External Interfaces
    subgraph External Inputs [External APIs & Scrapers]
        YF[Yahoo Finance Raw API]
        IS[İş Yatırım Scraper]
        BiQ[BiQuote Real-Time Feed]
        KAP[KAP Announcement Scraper]
    end

    %% Connections
    UI <-->|onSnapshot Real-time Sub| Firestore
    Watchlist <-->|onSnapshot Real-time Sub| Firestore
    Watchlist -->|Fetch missing symbols| API_Scan
    
    API_Bg --> Scanner
    API_Scan --> Scanner
    API_Cron --> Scanner
    
    Scanner -->|Pre-fetch bulk ticks| BiQ
    Scanner -->|Align historical closes| YF
    Scanner -->|Fetch fundamentals| IS
    Scanner -->|Scrape announcements| KAP
    
    Scanner --> Quant
    Scanner --> ML
    KAP --> Vertex
    
    Scanner -->|Sync Batch docs| Firestore
    Scanner -->|Sync Schema rows| DataConnect
    Scanner -->|Dispatch alarms| FCM
    FCM -->|Push notification| UI
```

---

## 2. Core Execution Flows

### Flow A: Stale-While-Revalidate Auto-Scanner
1. **User Mounts Scanner**: The user opens the web application. The frontend immediately loads the cached list of results from Firestore (zero blocking delay).
2. **Staleness Check**: The frontend checks the `lastRun` timestamp. If it is older than **5 minutes**, the browser automatically dispatches a background POST request to `/api/bist/background`.
3. **Lock & Scan**: The API locks the database (`isScanning = true`) so subsequent page loads don't trigger duplicate runs.
4. **Market-Wide Processing**: The system slices BIST symbols, pulls bulk real-time ticks from BiQuote, historical close lists from Yahoo Finance, and aggregates indicators.
5. **Real-time Push**: Results are committed to Firestore. The real-time listener `onSnapshot` instantly fires on all active browsers, rendering the updated results.

### Flow B: Tracker Panel Reactive Recovery (Missing Symbols)
1. **Personal Watchlist**: The user adds custom tickers to their browser `localStorage` watchlist (e.g. `DGATE`).
2. **Real-time Filter**: `TrackerPanel.tsx` reads Firestore. If `DGATE` was not part of the recent BIST 30/100 scan chunks, it will be flagged as `missing`.
3. **On-Demand Fast Scan**: The frontend calls `/api/bist/scan?symbols=DGATE`.
4. **Targeted Scan (<1s)**: The API executes `scanBistSymbols(["DGATE"], params)`. Instead of a full-market sweep, it performs an isolated scan, writes the output to Firestore, and returns it.
5. **Reactive Update**: Firestore triggers `onSnapshot` inside `TrackerPanel.tsx`, and the custom stock appears on the watchlist.

---

## 3. The Quantitative & Machine Learning Engine (`src/lib/quant/`)

BIST Analyst integrates institutional-grade quantitative algorithms for noise dampening, sizing, correlation, and regime identification:

| Engine Module | Purpose | Mathematical / Algorithm Details |
| :--- | :--- | :--- |
| **Adaptive Kalman Filter** (`kalman.ts`) | Noise Dampening | Dampens micro-price jitter and spreads. Scales process error covariance ($Q$) dynamically based on rolling 10-day price volatility. |
| **Fractional Kelly Sizing** (`kelly.ts`) | Capital Allocation | Evaluates optimal trade position size based on ML-predicted win rates ($p$) and risk odds ($b$). Employs a strict $1/4$ Kelly fraction for risk preservation. |
| **Pairs Trading Model** (`pairs.ts`) | Statistical Arbitrage | Computes rolling Pearson correlation coefficients and linear regressions to estimate dynamically changing hedge ratios. Standardizes spreads to Z-scores. |
| **HMM Regime Detector** (`regime.ts`) | Volatility Classification | Classifies market regimes into `TRENDING`, `RANGING`, or `VOLATILE/CRISIS` to dynamically widen entry bands during highly volatile market regimes. |
| **Purged K-Fold CV** (`mlPipeline.ts`) | ML Leakage Prevention | Enforces de Prado's event purging and safety embargo intervals to prevent look-ahead bias and leakage in time-series splits. |

---

## 4. Database & Synchronization Strategy

The system utilizes a **Dual-Redundancy Database Architecture** to maximize read speeds, support real-time pushes, and facilitate advanced SQL queries.

```
                  ┌───────────────────────┐
                  │ Background Scan Job   │
                  └───────────┬───────────┘
                              │
             ┌────────────────┴────────────────┐
             ▼                                 ▼
   ┌───────────────────┐             ┌───────────────────┐
   │    Firestore      │             │  Data Connect     │
   │   (NoSQL DB)      │             │  (PostgreSQL)     │
   ├───────────────────┤             ├───────────────────┤
   │ * Real-time push  │             │ * Complex queries │
   │ * SWR feeds       │             │ * Join analysis   │
   │ * Real-time logs  │             │ * Backtests       │
   └─────────┬─────────┘             └───────────────────┘
             │
             ▼
   ┌───────────────────┐
   │ Client Browser    │
   │ (onSnapshot)      │
   └───────────────────┘
```

*   **Firestore (NoSQL)**: Handles the real-time state. All clients subscribe to `scan_results` and `alarm_log` via lightweight websocket-like hooks.
*   **Firebase Data Connect (PostgreSQL)**: Handles structured analytics. The background engine logs every scan to PostgreSQL in parallel, enabling SQL-based backtesting and trend reporting without taxing the NoSQL databases.

---

## 5. Hosting & Deployment Stack (Google Cloud)

BIST Analyst is optimized for the next-generation **Google App Hosting** ecosystem:

1. **Frameworks Integration (Next.js Server Actions)**: Next.js SSR functions are automatically compiled into isolated **Google Cloud Functions (2nd Gen)** running on Node.js 24.
2. **Vertex AI Connection**: Connects to Vertex AI in the European region, providing sub-100ms latency for real-time generative news and sentiment checks via Gemini models.
3. **FCM push notifications**: Integrates service-worker FCM endpoints to immediately push high-confidence breakout alerts to registered devices.
