// src/app/api/bist/cointegration/route.ts
// Stat-arb pair screen: real Engle-Granger + Johansen cointegration testing
// (statsmodels, via python_bot's /api/cointegration) enriched with a live
// spread Z-score computed from the returned hedge ratio.
//
// src/lib/quant/pairs.ts already implements a TS approximation of Engle-Granger
// (simple OLS + no ADF stationarity test on the residuals), but nothing in the
// app ever called it. This route replaces that approximation's cointegration
// call with the real statsmodels test from python_bot, while reusing pairs.ts's
// spread/Z-score math against fresh price data for a live trade signal.

import { NextResponse } from "next/server";
import { getCointegration } from "@/lib/pythonEngine";
import { fetchYahooRaw } from "@/lib/bist";
import { calculateSpreadZScore, generatePairsSignal } from "@/lib/quant/pairs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const assetA = searchParams.get("assetA");
  const assetB = searchParams.get("assetB");
  const period = searchParams.get("period") || "2y";

  if (!assetA || !assetB) {
    return NextResponse.json(
      { success: false, error: "assetA and assetB parameters are required. (e.g. ?assetA=GARAN&assetB=AKBNK)" },
      { status: 400 }
    );
  }

  const cointegration = await getCointegration(assetA, assetB, period);

  if (!cointegration) {
    return NextResponse.json(
      {
        success: false,
        error: "Python quant engine unavailable — cointegration test could not be run.",
        pythonEngineAvailable: false,
      },
      { status: 503 }
    );
  }

  // Enrich with a live spread Z-score using the statistically-tested hedge
  // ratio (prefers Engle-Granger's OLS beta; falls back to Johansen's
  // eigenvector-derived ratio if EG didn't converge to a usable beta).
  let liveSignal: { spread: number; zScore: number; signal: string } | null = null;
  try {
    const hedgeRatio =
      cointegration.engle_granger?.hedge_ratio_beta ?? cointegration.johansen?.hedge_ratio_from_eigenvector;

    if (hedgeRatio != null && cointegration.consensus_cointegrated) {
      const [barsA, barsB] = await Promise.all([
        fetchYahooRaw(assetA, "1d", "3mo"),
        fetchYahooRaw(assetB, "1d", "3mo"),
      ]);

      if (barsA && barsB && barsA.length > 20 && barsB.length > 20) {
        const closesA = barsA.map((b) => b.close);
        const closesB = barsB.map((b) => b.close);
        const intercept = cointegration.engle_granger?.intercept_alpha ?? 0;

        const { spread, zScore } = calculateSpreadZScore(closesA, closesB, hedgeRatio, intercept, 20);
        // No dedicated regime call here to keep this a single-endpoint
        // integration (see /api/bist/... regime enrichment in src/lib/bist.ts);
        // "YATAY" (mean-reverting) is the standard default assumption for a
        // pairs trade, which by construction bets on mean reversion.
        const signal = generatePairsSignal(zScore, "YATAY");
        liveSignal = { spread, zScore, signal };
      }
    }
  } catch (err) {
    console.warn(`[cointegration route] Failed to compute live spread Z-score for ${assetA}/${assetB}:`, err);
  }

  return NextResponse.json({
    success: true,
    pythonEngineAvailable: true,
    data: cointegration,
    liveSignal,
  });
}
