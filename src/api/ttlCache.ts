/** Small in-memory cache with a time-to-live and a size cap (oldest entries are dropped first). */
export class TtlCache<V> {
  private readonly entries = new Map<string, { at: number; value: V }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.at >= this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key); // re-insert so the newest write is last
    this.entries.set(key, { at: this.now(), value });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /** Removes the entry, but only while it still holds this value. */
  deleteIf(key: string, value: V): void {
    if (this.entries.get(key)?.value === value) this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }
}
