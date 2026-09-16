import { fetchYahooOhlc } from "./src/lib/yfinance";
import { runBacktest } from "./src/lib/backtest";

async function test() {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const bars = await fetchYahooOhlc("THYAO.IS", ninetyDaysAgo, "1d");
  
  if (bars.length < 30) {
      console.log("Not enough bars");
      return;
  }

  const result = runBacktest({
    bars,
    initialCapital: 10000,
    strategy: "EMA_CROSS"
  });

  console.log(`Trades for THYAO:`, result.trades.length);
  if (result.trades.length > 0) {
      const lastBuy = [...result.trades].reverse().find(t => t.type === "BUY");
      const lastBar = bars[bars.length - 1];
      console.log("Last Buy:", lastBuy?.date.toISOString());
      console.log("Last Bar:", lastBar?.date.toISOString());
  }
}

test().catch(console.error);
