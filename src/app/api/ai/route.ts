import { NextResponse } from 'next/server';
import { fetchHistoricalScans, buildMLContext } from '@/lib/mlPipeline';

// Anthropic Claude (fallback)
let anthropic: any = null;
async function getAnthropicClient() {
  if (!anthropic && process.env.ANTHROPIC_API_KEY) {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic;
}

const CLAUDE_SYSTEM_PROMPT = `Sen Borsa İstanbul (BIST) için tasarlanmış, çok katmanlı bir Karar Destek Sistemi ve algoritmik analiz motorusun. Gelen her veriyi Makro, Temel, Rejim, Teknik (SMC+MTF), Takas (AKD) ve Risk süzgeçlerinden geçirirsin. Veri yoksa "Veri yetersiz" beyanını kullanır, kesinlikle tahmin yürütmezsin. 

Sisteminin en önemli kuralı: Duygusal yorum yok, sadece veri odaklı katı kural (if-this-then-that) mantığı geçerlidir. Analizini tamamladıktan sonra, sonucun insan okunabilir kısmını ve yazılım entegrasyonu için JSON bloğunu kesinlikle belirtilen formatta oluşturmalısın.

## ÇIKTI FORMATI
Çıktını her zaman ve SADECE aşağıdaki yapıya göre ver:

📊 **[HİSSE KODU] — Karar Destek Raporu**
📅 Tarih: [Tarih] | 🛡️ Beta: [Değer] | 🌡️ Rejim: [Boğa/Ayı/Yatay/Volatil]

1️⃣ **MAKRO, SEKTÖR VE AĞ DİNAMİKLERİ**
2️⃣ **TEMEL, TAKAS VE SENTİMENT**
3️⃣ **TEKNİK VE SMC (AKILLI PARA) HARİTASI**
4️⃣ **MTF MATRİSİ (ZAMAN DİLİMİ UYUMU)**
5️⃣ **AKŞİYON VE RİSK YÖNETİMİ**

---
\`\`\`json
{
  "asset": "[HİSSE KODU]",
  "timestamp": "[ISO 8601]",
  "regime": "[BULL/BEAR/RANGE/VOLATILE]",
  "decision": "[STRONG_BUY/BUY/HOLD/SELL/STRONG_SELL]",
  "mtf_confluence": true/false,
  "position_sizing_pct": 100/50/25/0,
  "confidence_score": 0-100,
  "levels": {
    "entry_zone": ["FİYAT_1", "FİYAT_2"],
    "stop_loss": "FİYAT",
    "take_profit_1": "FİYAT",
    "take_profit_2": "FİYAT",
    "vwap": "FİYAT"
  },
  "tactical_metrics": {
    "dark_pool_block_trade_detected": true/false,
    "corporate_action_catalyst": "DETAY_VEYA_NULL"
  },
  "akd_flow": "ACCUMULATION/DISTRIBUTION/NEUTRAL",
  "sentiment_trap": "SELL_THE_NEWS_TRAP/BUY_THE_DIP_TRAP/NONE",
  "risk_flags": ["RİSK_1", "RİSK_2"],
  "fibonacci_proximity": 0-100,
  "xai_breakdown": [
    {"indicator": "NAME", "contribution": 0.0, "role": "SUPPORTING/OPPOSING_DRAG"}
  ]
}
\`\`\``;

export async function POST(request: Request) {
  try {
    const { stockData } = await request.json();
    if (!stockData || !stockData.ticker) {
      return NextResponse.json({ error: "No stock data provided" }, { status: 400 });
    }

    // ─── ML Context Building ──────────────────────────────────────
    let historicalContext: any[] = [];
    let mlInsight: any = null;
    try {
      historicalContext = await fetchHistoricalScans(stockData.ticker, 30);
      if (historicalContext.length > 0) {
        const mlCtx = buildMLContext(stockData.ticker, stockData, historicalContext);
        mlInsight = {
          trendDirection: mlCtx.trendDirection,
          avgScore: mlCtx.avgScore,
          scoreVolatility: mlCtx.scoreVolatility,
          fakeoutFrequency: mlCtx.fakeoutFrequency,
          alertFrequency: mlCtx.alertFrequency,
        };
      }
    } catch (err) {
      console.warn("[AI Route] ML context building failed:", err);
    }

    // ─── ENGINE SELECTION: Claude (Primary) → Algorithmic (Fallback) ──
    // Google Gemini/Genkit removed (was the cloud dependency here); Claude
    // was already a supported fallback and needs no GCP project.

    // 1️⃣ Try Anthropic Claude
    const claudeClient = await getAnthropicClient();
    if (claudeClient) {
      try {
        console.log(`[AI Route] Using Claude for ${stockData.ticker}`);
        const indexStr = stockData.indexTag ? `Endeks: ${stockData.indexTag}` : "Endeks: BIST TÜM";

        const userPrompt = `Lütfen aşağıdaki BIST hisse verilerini analiz et.
Hisse: ${stockData.ticker} (${stockData.name})
${indexStr}
Fiyat: ${stockData.price} TRY | Değişim: ${stockData.change}%
Score: ${stockData.score}/100 | RSI: ${stockData.rsi}
Volume Multiple: ${stockData.volumeMultiple}x | SMA20 Dist: ${stockData.sma20Distance}%
${stockData.timeframes ? `Timeframes: ${JSON.stringify(stockData.timeframes)}` : ''}
${mlInsight ? `ML Insight: ${JSON.stringify(mlInsight)}` : ''}`;

        const message = await claudeClient.messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1500,
          temperature: 0.2,
          system: CLAUDE_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }],
        });

        const content = message.content[0];
        if (content.type === 'text') {
          const fullText = content.text;
          let markdown = fullText;
          let parsedData = null;

          const jsonMatch = fullText.match(/```json\n([\s\S]*?)\n```/);
          if (jsonMatch && jsonMatch[1]) {
            try {
              parsedData = JSON.parse(jsonMatch[1]);
              markdown = fullText.replace(/```json\n[\s\S]*?\n```/, '').trim();
            } catch (e) {
              console.error("Failed to parse Claude JSON block:", e);
            }
          }

          if (parsedData && mlInsight) {
            parsedData.ml_insight = mlInsight;
          }

          return NextResponse.json({ analysis: markdown, metrics: parsedData, engine: "claude" });
        }
      } catch (claudeErr) {
        console.error("[AI Route] Claude failed:", claudeErr);
      }
    }

    // 3️⃣ Algorithmic Fallback (No API keys)
    console.log(`[AI Route] Using algorithmic fallback for ${stockData.ticker}`);
    const isBullish = (stockData.score || 0) >= 50;
    const trend = isBullish ? "BULLISH" : "BEARISH";
    const p = parseFloat(stockData.price) || 100;
    const fvgLevel = (p * (isBullish ? 0.98 : 1.02)).toFixed(2);
    const obLevel = (p * (isBullish ? 0.95 : 1.05)).toFixed(2);
    const target1 = (p * (isBullish ? 1.04 : 0.96)).toFixed(2);
    const target2 = (p * (isBullish ? 1.08 : 0.92)).toFixed(2);
    const stopLoss = (p * (isBullish ? 0.94 : 1.06)).toFixed(2);

    const report = `*(API anahtarı bulunamadı. Algoritmik SMC analizi sunuluyor)*

**Macro/Micro Bias:** ${trend}
Makro yapı ${stockData.score}/100 teknik skor ile ${trend.toLowerCase()} eğilim gösteriyor. Değişim: ${stockData.change}%, Hacim: ${stockData.volumeMultiple}x.

**Institutional Zones:**
- **FVG:** ${fvgLevel} ₺ | **OB:** ${obLevel} ₺
- **Volume POC:** ${isBullish ? 'destek' : 'direnç'} bölgesinde

**Setup:**
Confluans: ${stockData.score}/100 | RSI: ${parseFloat(stockData.rsi || 50).toFixed(1)} | SMA20: ${stockData.sma20Distance}%

**Execution:**
- Entry: ${fvgLevel}₺ - ${obLevel}₺
- Stop: ${stopLoss}₺ | TP1: ${target1}₺ | TP2: ${target2}₺
${mlInsight ? `\n**ML Insight:** Score Trend=${mlInsight.trendDirection}, Avg=${mlInsight.avgScore.toFixed(0)}, Fakeout Risk=%${mlInsight.fakeoutFrequency.toFixed(0)}` : ''}`;

    const fallbackMetrics = {
      decision: isBullish ? "BUY" : "HOLD",
      regime: isBullish ? "BULL" : "BEAR",
      position_sizing_pct: isBullish ? 50 : 0,
      confidence_score: stockData.score || 0,
      mtf_confluence: false,
      levels: {
        entry_zone: [fvgLevel, obLevel],
        stop_loss: stopLoss,
        take_profit_1: target1,
        take_profit_2: target2,
      },
      ml_insight: mlInsight,
    };

    return NextResponse.json({ analysis: report, metrics: fallbackMetrics, engine: "algorithmic" });

  } catch (error: any) {
    console.error("AI Analysis Error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
