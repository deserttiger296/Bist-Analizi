// scripts/test_rule_engine.ts
import { evaluateAllRules } from "../src/lib/tradingRules/engine";
import { OHLCV, RuleContext } from "../src/lib/tradingRules/types";

// Generate mock bars representing a strong stage 2 uptrend
function generateMockBars(): OHLCV[] {
  const bars: OHLCV[] = [];
  let price = 100;
  
  // Create 250 bars
  for (let i = 0; i < 250; i++) {
    // Stage 2 uptrend behavior: higher highs and higher lows
    const trendFactor = i > 150 ? 0.8 : 0.2; // Accelerate later
    const rand = (Math.random() - 0.3) * 2; // Bias positive
    const change = rand + trendFactor;
    price += change;
    
    bars.push({
      date: new Date(2025, 0, i + 1).toISOString(),
      open: price - 1,
      high: price + 2,
      low: price - 2,
      close: price,
      volume: 10000 + Math.round(Math.random() * 5000) + (i > 240 ? 10000 : 0) // Volume expansion on breakout
    });
  }
  return bars;
}

async function testEngine() {
  console.log("=== TESTING TRADING RULE ENGINE ===");
  const bars = generateMockBars();
  
  const mockQuote = {
    rsi: 65,
    lastClose: bars[bars.length - 1].close
  };
  
  const ctx: RuleContext = {
    symbol: "THYAO.IS",
    bars: bars,
    marketIndex: bars, // self as index for mock simplicity
    quote: mockQuote,
    fundamentals: {
      epsGrowthYoY: [0.15, 0.25, 0.35],
      revenueGrowthYoY: [0.1, 0.2, 0.3],
      netMargin: [0.12, 0.15, 0.18]
    }
  };
  
  console.time("Evaluation Time");
  const result = evaluateAllRules(ctx);
  console.timeEnd("Evaluation Time");
  
  console.log(`\nResult for ${result.symbol}:`);
  console.log(`- Composite Score: ${result.compositeScore}`);
  console.log(`- Passed Trend Filters: ${result.passedFilters}`);
  console.log(`- Final Signal: ${result.signal}`);
  console.log(`- Top Reasons:`, result.reasons);
  
  console.log("\nRule Breakdown (showing passed or critical rules):");
  result.allResults.forEach(r => {
    if (r.passed || ["MM-01", "MM-08", "ST-02", "WMD-07"].includes(r.ruleId)) {
      console.log(`  [${r.ruleId}] Passed: ${r.passed} | Score: ${r.score} | Reason: ${r.reason}`);
    }
  });
}

testEngine().catch(console.error);
