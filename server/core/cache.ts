export interface CacheStats {
  hits: number
  misses: number
  size: number
  evictions: number
}

interface Entry<V> {
  value: V
  expiresAt: number
}

/**
 * Prosty cache TTL + LRU dla zapytan do uslug CBDG.
 * Dane CBDG zmieniaja sie rzadko, wiec domyslny TTL = 6 h.
 * Instancja zyje tak dlugo, jak instancja funkcji serverless (cieply start).
 */
export class TtlCache<V = unknown> {
  private map = new Map<string, Entry<V>>()
  private stats: CacheStats = { hits: 0, misses: 0, size: 0, evictions: 0 }

  constructor(
    private readonly ttlMs: number = 6 * 60 * 60 * 1000,
    private readonly maxEntries: number = 500,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key)
    if (!hit) {
      this.stats.misses++
      return undefined
    }
    if (hit.expiresAt <= this.now()) {
      this.map.delete(key)
      this.stats.misses++
      return undefined
    }
    // odswiez pozycje w kolejce LRU
    this.map.delete(key)
    this.map.set(key, hit)
    this.stats.hits++
    return hit.value
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, { value, expiresAt: this.now() + this.ttlMs })
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next()
      if (oldest.done) break
      this.map.delete(oldest.value)
      this.stats.evictions++
    }
    this.stats.size = this.map.size
  }

  has(key: string): boolean {
    const hit = this.map.get(key)
    return !!hit && hit.expiresAt > this.now()
  }

  clear(): void {
    this.map.clear()
    this.stats.size = 0
  }

  getStats(): CacheStats {
    return { ...this.stats, size: this.map.size }
  }
}

/** Wspoldzielony cache dla wszystkich zapytan CBDG w obrebie instancji funkcji. */
export const cbdgCache = new TtlCache<unknown>()
