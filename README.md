# BIST-Analyst Web App
**Kazananlar Kulübü** — AI-powered BIST stock analysis and trading signal generator

## Features

- **Multi-Timeframe Analysis**: Analyze stocks across 1H, 4H, 1D, 1W, 1M timeframes
- **Comprehensive Scoring**: Technical, Fundamental, Macro, and Sentiment analysis
- **Trading Signals**: STRONG BUY, BUY, HOLD, SELL, STRONG SELL with confidence levels
- **Risk Management**: Stop loss and take profit calculations
- **Dark Mode Dashboard**: Modern UI with real-time stock data
- **BIST-Specific Logic**: Built-in TMS 29 inflation accounting, FX sensitivity, TCMB awareness

## Tech Stack

- **Next.js 15** with Turbopack
- **React 19**
- **TypeScript**
- **Tailwind CSS**
- **Recharts** for data visualization
- **ESLint** for code quality

## Getting Started

### Prerequisites

- Node.js 18+ (installed automatically)
- npm

### Installation

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Open http://localhost:3000
```

### Build for Production

```bash
npm run build
npm start
```

## Project Structure

```
src/
├── app/
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Home page
│   └── globals.css         # Global styles
├── components/
│   ├── Dashboard.tsx       # Main dashboard
│   ├── StockCard.tsx       # Stock card component
│   ├── AnalysisPanel.tsx   # Analysis details
│   └── ScoreChart.tsx      # Score visualization
└── types/
    └── stock.ts            # TypeScript types (to be added)
```

## Features Implementation Roadmap

- [ ] Real-time BIST data integration
- [ ] WebSocket for live price updates
- [ ] Advanced chart tools (TradingView integration)
- [ ] Watchlist management
- [ ] Historical signal performance tracking
- [ ] Alert system
- [ ] Portfolio tracking
- [ ] API backend for analysis engine

## License

MIT
