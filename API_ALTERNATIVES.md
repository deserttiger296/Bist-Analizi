# API Alternatives & Fallback Strategy

## Overview

Path A uses a **multi-source fallback strategy** to ensure verdicts always work:

```
Finnhub (Turkish/BIST focused)
    ↓ (if fails or no key)
NewsAPI (Broad coverage)
    ↓ (if fails or no key)
Twelve Data (Stock-focused)
    ↓ (if all fail)
Demo Mode (Always works, no API needed)
```

## Recommended Setup

### Best Option: Finnhub + Claude
- **News Source**: Finnhub (excellent for Turkish/BIST stocks)
- **Sentiment**: Claude AI (understands Turkish nuance)
- **Cost**: FREE
- **Setup time**: 2 minutes

**Why?**
- Finnhub optimized for international stocks including Turkey
- 60 API calls/minute (plenty for 500 stocks on 4h cache)
- Claude excellent at Turkish sentiment analysis
- No rate limiting issues with 4-hour caching

### Alternative 1: NewsAPI + Claude
- **News Source**: NewsAPI (100 requests/day)
- **Sentiment**: Claude AI
- **Setup time**: 2 minutes
- **Limitation**: May hit 100/day limit if checking all 500 stocks frequently

### Alternative 2: Twelve Data
- **News Source**: Twelve Data (800 calls/day)
- **Sentiment**: Claude AI
- **Cost**: FREE
- **Setup time**: 2 minutes

---

## Setup Instructions

### Step 1: Choose ONE News Source

#### Option A: Finnhub (RECOMMENDED)
```bash
# 1. Go to https://finnhub.io/
# 2. Sign up (takes 2 minutes, FREE)
# 3. Get API key from dashboard
# 4. Add to .env.local:
FINNHUB_API_KEY=your_key_here

# 5. Test it:
npm run dev
```

#### Option B: NewsAPI
```bash
# 1. Go to https://newsapi.org/
# 2. Sign up (FREE - 100 requests/day)
# 3. Get API key
# 4. Add to .env.local:
NEWSAPI_KEY=your_key_here
```

#### Option C: Twelve Data
```bash
# 1. Go to https://twelvedata.com/
# 2. Sign up (FREE - 800 calls/day)
# 3. Get API key
# 4. Add to .env.local:
TWELVEDATA_API_KEY=your_key_here
```

### Step 2: Verify ANTHROPIC_API_KEY
```bash
# Make sure you have Claude API key (used for sentiment analysis)
# In .env.local:
ANTHROPIC_API_KEY=sk-ant-xxxxx
```

### Step 3: Run
```bash
npm run dev
```

---

## API Comparison

| API | Free Tier | Requests/Day | Best For | Setup |
|-----|-----------|-------------|----------|-------|
| **Finnhub** | ✅ | 60/min | Turkish/BIST stocks | 2 min |
| **NewsAPI** | ✅ | 100/day | Broad coverage | 2 min |
| **Twelve Data** | ✅ | 800/day | Stock-focused news | 2 min |
| **No API** | ✅ | Unlimited | Demo verdicts | 0 min |

---

## No API Key? That's OK!

If you don't set any API key, the system falls back to **Demo Mode**:

```
✅ App works perfectly
✅ Verdicts show (demo data)
✅ UI fully functional
❌ News sentiment not real

Upgrade anytime by adding one API key
```

**Demo verdict example:**
```
"✓ Olumlu haber havası. Teknik kırılım onaylanmış."
```

---

## Troubleshooting

### "No news APIs configured" warning

**This is OK!** Means:
- No API keys set (or all invalid)
- System using demo verdicts
- Everything still works

**To fix:** Set one API key and restart

### Getting 403/401 errors

**Check:**
1. API key is correct (not expired)
2. API service is not down
3. You haven't exceeded rate limits
4. Check your API dashboard quota

### Verdicts not updating after 4 hours

**This is expected:** Cache TTL is 4 hours. To force refresh:
```bash
curl http://localhost:3000/api/verdicts/GARAN?forceRefresh=true
```

### Which API should I choose?

**Decision tree:**
- Trading Turkish stocks? → **Finnhub** (optimized for intl markets)
- Want broad news? → **NewsAPI** (most sources)
- High volume needed? → **Twelve Data** (800/day)
- Just testing? → **Demo Mode** (no setup)

---

## Production Deployment

For production deployment to platforms like **Vercel**, **Netlify**, or **Railway**:

1. Add environment variables to your deployment platform's dashboard
2. Set the same keys:
   - `ANTHROPIC_API_KEY`
   - `FINNHUB_API_KEY` (or `NEWSAPI_KEY` or `TWELVEDATA_API_KEY`)

Example for Vercel:
```
Settings > Environment Variables > Add:
- ANTHROPIC_API_KEY = sk-ant-xxxxx
- FINNHUB_API_KEY = your_key_here
```

Then deploy:
```bash
git push  # or use Vercel dashboard
```

---

## Cost Breakdown (all FREE)

| Component | Cost | Notes |
|-----------|------|-------|
| Claude API | $3-15/month | Pay-as-you-go (for sentiment analysis) |
| Finnhub | $0 | Free tier (60 calls/min) |
| NewsAPI | $0 | Free tier (100 requests/day) |
| Twelve Data | $0 | Free tier (800 calls/day) |
| **Total** | **~$0-15/month** | Depends on Claude usage |

---

## API Rate Limits & Caching

With **4-hour caching**, here's your daily quota consumption:

```
500 stocks ÷ (4 hours × 60 min) = ~2 stocks/minute
= 2,880 API calls per day (if checking 500 stocks 24/7)

But most days you'll check:
- Top 50 stocks = 50/day
- Dashboard reloads = 5-10/day
- Total = ~60/day (well within any free tier)
```

---

## Adding a New API Source

If you want to add another news API:

1. Add fetch function to `src/lib/newsService.ts`
2. Add to fallback chain in `fetchStockNews()`
3. Set environment variable in `.env.local`
4. Restart dev server

Example:
```typescript
// In fetchStockNews():
if (YOUR_API_KEY) {
  const news = await fetchYourApi(symbol, limit).catch(() => null);
  if (news && news.length > 0) return news;
}
```

---

## Support

**Questions?**
- Check `.env.example` for all available keys
- Read API documentation: Finnhub | NewsAPI | Twelve Data
- API demo mode works offline (no internet needed for structure)
