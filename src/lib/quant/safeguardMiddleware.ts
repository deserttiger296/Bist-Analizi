import pool from '../db';

export interface SafeguardCheckResult {
  isAllowed: boolean;
  blockedBy: string[];    // e.g. ["LIQUIDITY", "SECTOR_CAP", "WEEKLY_EMA26"]
  warnings: string[];
}

export interface SafeguardContext {
  adtv10: number; // Average Daily Traded Volume (10 days) in TL
  weeklyEma26: number;
  currentPrice: number;
  usdTryVolDaily: number;
  activePositionsCount: number;
  sectorPositionsCount: number;
  symbol: string;
}

/**
 * Execution Safeguards Middleware
 * All signals must pass through this funnel before being recommended to users.
 */
export class SafeguardMiddleware {
  // Configurable thresholds
  private MIN_LIQUIDITY_TL = 25_000_000; // 25M TL daily volume minimum
  private MAX_TOTAL_POSITIONS = 10;
  private MAX_SECTOR_POSITIONS = 2;
  private MACRO_VOL_THRESHOLD = 2.0; // 2% USD/TRY volatility
  private DEFAULT_SCORE_THRESHOLD = 60;
  private ELEVATED_SCORE_THRESHOLD = 70;

  constructor(private context: SafeguardContext) {}

  /**
   * Evaluates all execution safeguards.
   */
  public async evaluate(): Promise<SafeguardCheckResult> {
    const blockedBy: string[] = [];
    const warnings: string[] = [];

    // 1. Liquidity Check
    if (this.context.adtv10 < this.MIN_LIQUIDITY_TL) {
      blockedBy.push('LIQUIDITY');
    }

    // 2. Weekly EMA26 Guard (Dead Cat Bounce Protection)
    if (this.context.currentPrice < this.context.weeklyEma26) {
      blockedBy.push('WEEKLY_EMA26');
    }

    // 3. Position Limits
    if (this.context.activePositionsCount >= this.MAX_TOTAL_POSITIONS) {
      blockedBy.push('PORTFOLIO_CAP');
    }
    if (this.context.sectorPositionsCount >= this.MAX_SECTOR_POSITIONS) {
      blockedBy.push('SECTOR_CAP');
    }

    // 4. Macro Shield
    if (this.context.usdTryVolDaily > this.MACRO_VOL_THRESHOLD) {
      warnings.push(`MACRO_SHIELD_ACTIVE (Threshold raised to ${this.ELEVATED_SCORE_THRESHOLD})`);
    }

    // 5. Backtest Validation Check
    // We check PostgreSQL if any valid signals exist for this symbol (optional per-symbol strictness)
    // For now, we will do a fast DB lookup to see if the asset has a positive historical edge
    try {
      const isValid = await this.checkAssetHistoricalEdge(this.context.symbol);
      if (!isValid) {
        // We only warn here, because confluence score might be strong enough, but we log the warning.
        warnings.push('NO_HISTORICAL_EDGE');
      }
    } catch (e) {
      console.warn("Could not check historical edge:", e);
    }

    return {
      isAllowed: blockedBy.length === 0,
      blockedBy,
      warnings
    };
  }

  /**
   * Determine the final score threshold based on Macro Shield
   */
  public getScoreThreshold(): number {
    return this.context.usdTryVolDaily > this.MACRO_VOL_THRESHOLD 
      ? this.ELEVATED_SCORE_THRESHOLD 
      : this.DEFAULT_SCORE_THRESHOLD;
  }

  /**
   * Fast lookup in PostgreSQL BacktestResult table.
   * If the system ran backtests, we check if the asset has > 50% win rate overall.
   */
  private async checkAssetHistoricalEdge(symbol: string): Promise<boolean> {
    const res = await pool.query(
      `SELECT "winRate" FROM "BacktestResult" 
       WHERE symbol = $1 
       ORDER BY "createdAt" DESC LIMIT 1`,
      [symbol]
    );

    if (res.rowCount && res.rowCount > 0) {
      return res.rows[0].winRate >= 50.0;
    }
    
    // Default to true if no backtest data exists yet
    return true; 
  }
}
