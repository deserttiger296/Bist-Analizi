# 🚀 Path A: AI Verdict & Sentiment Implementation

## What's New

Your app now has **Institutional Verdicts** powered by AI-driven news sentiment analysis:

- **4-Hour Cache**: Verdicts are cached for 4 hours to minimize API calls
- **On-Demand Generation**: Fetch fresh verdicts anytime via API
- **Turkish Summaries**: All verdicts and analysis in Turkish
- **Multi-Source News**: Finnhub → NewsAPI → Twelve Data (with fallbacks)
- **Automatic Sentiment Integration**: News sentiment combined with technical scores

## Quick Start (2 minutes)

### Option 1: Auto-Demo Mode (NO API KEY NEEDED)
```bash
npm run dev
```
App works immediately with demo verdicts. Upgrade anytime by adding API keys.

### Option 2: With Real News (Recommended)

**Choose ONE:**

#### A) Finnhub (Best for Turkish/BIST)
1. Go to https://finnhub.io/
2. Sign up (FREE - 60 calls/min)
3. Copy API Key
4. Add to `.env.local`:
   ```env
   FINNHUB_API_KEY=your_key_here
   ```

#### B) NewsAPI (Broad coverage)
1. Go to https://newsapi.org/
2. Sign up (FREE - 100 requests/day)
3. Copy API Key
4. Add to `.env.local`:
   ```env
   NEWSAPI_KEY=your_key_here
   ```

#### C) Twelve Data (Stock-focused)
1. Go to https://twelvedata.com/
2. Sign up (FREE - 800 calls/day)
3. Copy API Key
4. Add to `.env.local`:
   ```env
   TWELVEDATA_API_KEY=your_key_here
   ```

### Then run:
```bash
npm run dev
```

## API Endpoints

### Get Verdict (Cached or Fresh)
```
GET /api/verdicts/:symbol
```

**Response:**
```json
{
  "verdict": "✓ Olumlu haber havası. Teknik kırılım onaylanmış.",
  "cached": true,
  "timestamp": "2025-05-11T14:30:00Z"
}
```

- `cached: true` = Served from 4-hour cache
- `cached: false` = Newly generated

## How It Works

1. **News Fetching** (`newsService.ts`):
   - Tries Finnhub first (best for Turkish)
   - Falls back to NewsAPI if Finnhub fails
   - Falls back to Twelve Data if both fail
   - Falls back to demo data if all fail
   - Multiple sources ensure reliability

2. **Sentiment Analysis** (`sentimentService.ts`):
   - Claude analyzes news headlines for sentiment
   - Returns: BULLISH / NEUTRAL / BEARISH
   - Includes Turkish 1-line summary

3. **Verdict Generation** (`/api/verdicts/[symbol]`):
   - Combines sentiment with technical context
   - Caches result for 4 hours
   - On-demand refresh available

4. **UI Display** (`VerdictDisplay.tsx` in `StockCard.tsx`):
   - Shows verdict on each stock card
   - Color-coded by sentiment
   - Indicates if cached or fresh

## Caching Strategy

- **Default**: 4-hour TTL per stock
- **Memory-based**: Uses in-process Map (suffices for 500 stocks)
- **Cleanup**: Automatic hourly cleanup of expired entries
- **Production Note**: For scale, migrate to Redis

## Limitations & Notes

- NewsAPI free tier: 100 requests/day (sufficient with 4h cache)
- Finnhub free tier: 60 requests/min (plenty for all stocks)
- Twelve Data free tier: 800 requests/day (excellent for volume)
- Turkish language support: Optimized for Turkish financial news
- No API key = Demo mode (generates sample verdicts)
- Cache is per-process (resets on restart in dev)

## Troubleshooting

**Issue: "No news APIs configured" in logs**
- This is NORMAL if you haven't set any API keys yet
- System falls back to demo verdicts
- Everything works fine!

**Issue: "Verdikt oluşturulamadı"**
- Check your API keys are valid
- Verify ANTHROPIC_API_KEY is set in `.env.local`
- Check API service is not down
- Demo mode should still work

**Issue: Verdicts not updating**
- Cache persists for 4 hours (by design)
- To force refresh: `GET /api/verdicts/TICKER?forceRefresh=true`

**Issue: Getting 403/401 errors**
- API key expired or invalid
- Check your API dashboard
- Regenerate and update `.env.local`

## Next Steps

**Path B (Portfolio Risk Hub):**
- Track your real trades with VaR calculations
- Compare target distance vs stop loss

**Path C (Multi-Timeframe Matrix):**
- Single-screen view: 1h, 4h, Daily, Weekly trends
- Real-time BIST 100 correlation

---

**Need alternatives?** See [API_ALTERNATIVES.md](API_ALTERNATIVES.md)

---

**Questions?** Check the implementation:
- `/src/lib/newsService.ts` - Multi-source news fetching
- `/src/lib/sentimentService.ts` - Sentiment analysis
- `/src/lib/verdictCache.ts` - Cache management
- `/src/app/api/verdicts/[symbol]/route.ts` - API endpoint
- `/src/components/VerdictDisplay.tsx` - UI component
