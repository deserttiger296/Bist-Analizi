// In-memory cache for verdicts with 4-hour TTL
// In production, consider using Redis for distributed caching

export interface VerdictCache {
  verdict: string;
  timestamp: number;
  expires: number;
}

class VerdictCacheManager {
  private cache: Map<string, VerdictCache> = new Map();
  private readonly TTL_HOURS = 4;
  private readonly TTL_MS = this.TTL_HOURS * 60 * 60 * 1000;

  /**
   * Get cached verdict if valid (not expired)
   */
  get(symbol: string): string | null {
    const cached = this.cache.get(symbol);
    if (!cached) return null;

    // Check if expired
    if (Date.now() > cached.expires) {
      this.cache.delete(symbol);
      return null;
    }

    return cached.verdict;
  }

  /**
   * Set verdict in cache with 4-hour expiration
   */
  set(symbol: string, verdict: string): void {
    this.cache.set(symbol, {
      verdict,
      timestamp: Date.now(),
      expires: Date.now() + this.TTL_MS,
    });
  }

  /**
   * Clear all expired entries (run periodically)
   */
  clearExpired(): void {
    const now = Date.now();
    for (const [symbol, data] of this.cache.entries()) {
      if (now > data.expires) {
        this.cache.delete(symbol);
      }
    }
  }

  /**
   * Get cache stats (for debugging)
   */
  getStats() {
    this.clearExpired();
    return {
      size: this.cache.size,
      ttlHours: this.TTL_HOURS,
      entries: Array.from(this.cache.entries()).map(([symbol, data]) => ({
        symbol,
        age: Math.round((Date.now() - data.timestamp) / 1000 / 60) + 'min',
        expiresIn: Math.round((data.expires - Date.now()) / 1000 / 60) + 'min',
      })),
    };
  }
}

// Global singleton instance
export const verdictCache = new VerdictCacheManager();

// Cleanup expired entries every hour
setInterval(() => {
  verdictCache.clearExpired();
}, 60 * 60 * 1000);
