import fs from 'fs';
import path from 'path';

const CACHE_FILE = path.join(process.cwd(), '.cache', 'bist_cache.json');
const CACHE_DIR = path.dirname(CACHE_FILE);

// Ensure cache directory exists
if (typeof window === 'undefined') {
  if (!fs.existsSync(CACHE_DIR)) {
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    } catch (err) {
      console.error('[Cache] Failed to create cache directory:', err);
    }
  }
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class LocalCache {
  private stats = { hits: 0, misses: 0, writes: 0, errors: 0 };
  private memoryCache = new Map<string, CacheEntry<any>>();

  private getFilePath(key: string): string {
    const safeKey = key.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    return path.join(CACHE_DIR, `${safeKey}.json`);
  }

  async get<T>(key: string): Promise<T | null> {
    // 1. Try memory cache first (ultra-fast, 0ms, non-blocking)
    const memEntry = this.memoryCache.get(key);
    if (memEntry && (Date.now() - memEntry.timestamp < memEntry.ttl)) {
      this.stats.hits++;
      return memEntry.data as T;
    }

    if (typeof window !== 'undefined') return null;
    
    // 2. Fallback to file cache
    const file = this.getFilePath(key);
    try {
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf-8');
        const entry = JSON.parse(raw) as CacheEntry<T>;
        if (entry && (Date.now() - entry.timestamp < entry.ttl)) {
          this.stats.hits++;
          // Save to memory cache for fast subsequent reads
          this.memoryCache.set(key, entry);
          return entry.data;
        }
        // Expired — remove stale file
        try { fs.unlinkSync(file); } catch {}
      }
    } catch (err) {
      // Ignore filesystem errors in read-only environments
    }

    this.stats.misses++;
    return null;
  }

  async set<T>(key: string, data: T, ttlMs: number): Promise<void> {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: ttlMs,
    };

    // 1. Save to memory cache immediately (instant)
    this.memoryCache.set(key, entry);

    if (typeof window !== 'undefined') return;

    // 2. Save to file cache asynchronously
    const file = this.getFilePath(key);
    fs.writeFile(file, JSON.stringify(entry), 'utf-8', (err) => {
      if (err) {
        // Ignore read-only filesystem writes
      } else {
        this.stats.writes++;
      }
    });
  }

  async delete(key: string): Promise<void> {
    if (typeof window !== 'undefined') return;
    const file = this.getFilePath(key);
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (err) {}
  }

  getStats() {
    return { ...this.stats };
  }

  logStats() {
    console.log(`[Cache] Stats — hits: ${this.stats.hits}, misses: ${this.stats.misses}, writes: ${this.stats.writes}, errors: ${this.stats.errors}`);
  }
}

export const Cache = new LocalCache();
