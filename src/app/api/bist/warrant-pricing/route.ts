import { NextResponse } from "next/server";

// Cumulative Standard Normal Distribution Approximation (accurate to 5 decimal places)
function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804 * Math.exp((-x * x) / 2);
  const p =
    ((((1.330274429 * t - 1.821255978) * t + 1.781477937) * t - 0.356563782) * t + 0.31938153) * t;
  const q = 1 - d * p;
  return x >= 0 ? q : 1 - q;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const spot = parseFloat(searchParams.get("spot") || "0");
  const strike = parseFloat(searchParams.get("strike") || "0");
  const volatility = parseFloat(searchParams.get("volatility") || "0.3");
  const rate = parseFloat(searchParams.get("rate") || "0.45"); // Default risk-free rate of 45% in Turkey
  const expiryDays = parseInt(searchParams.get("expiry_days") || "60", 10);
  const isCall = searchParams.get("is_call") !== "false";

  if (!spot || !strike || spot <= 0 || strike <= 0) {
    return NextResponse.json({ error: "Invalid spot or strike price" }, { status: 400 });
  }
  if (!(volatility > 0)) {
    return NextResponse.json({ error: "Volatility must be greater than 0" }, { status: 400 });
  }

  try {
    const t = expiryDays / 365.0;
    if (t <= 0) {
      return NextResponse.json({ price: 0, delta: 0, gamma: 0 });
    }

    const d1 =
      (Math.log(spot / strike) + (rate + (volatility * volatility) / 2.0) * t) /
      (volatility * Math.sqrt(t));
    const d2 = d1 - volatility * Math.sqrt(t);

    const nd1 = normalCDF(d1);
    const nd2 = normalCDF(d2);
    const nnd1 = normalCDF(-d1);
    const nnd2 = normalCDF(-d2);

    let theoreticalValue = 0;
    let delta = 0;

    if (isCall) {
      theoreticalValue = spot * nd1 - strike * Math.exp(-rate * t) * nd2;
      delta = nd1;
    } else {
      theoreticalValue = strike * Math.exp(-rate * t) * nnd2 - spot * nnd1;
      delta = nd1 - 1;
    }

    // Gamma = Standard Normal Probability Density Function value of d1 / (spot * volatility * sqrt(t))
    const np_d1 = Math.exp((-d1 * d1) / 2) / Math.sqrt(2 * Math.PI);
    const gamma = np_d1 / (spot * volatility * Math.sqrt(t));

    return NextResponse.json({
      pricing_model: "Black-Scholes-Merton (TypeScript Native)",
      spot,
      strike,
      volatility,
      risk_free_rate: rate,
      expiry_days: expiryDays,
      is_call: isCall,
      theoretical_value: Math.max(0, theoreticalValue),
      delta,
      gamma,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
