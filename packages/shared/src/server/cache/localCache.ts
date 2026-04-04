import { LRUCache } from "lru-cache";
import { logger } from "../logger";
import { recordGauge, recordIncrement } from "../instrumentation";

export type LocalCacheLoadResult<V> = {
  value: V | undefined;
  ttlMs?: number;
  source?: string;
};

export type LocalCacheConfig<K extends {}, V extends {}> = {
  namespace: string;
  enabled: boolean;
  ttlMs: number;
  max: number;
  maxSize: number;
  maxEntrySize?: number;
  sizeCalculation: (value: V, key: K) => number;
};

export class LocalCache<K extends {}, V extends {}> {
  private readonly cache: LRUCache<K, V>;
  private readonly inflightLoads = new Map<
    K,
    Promise<LocalCacheLoadResult<V>>
  >();

  constructor(private readonly config: LocalCacheConfig<K, V>) {
    this.cache = new LRUCache<K, V>({
      max: config.max,
      maxSize: config.maxSize,
      maxEntrySize: config.maxEntrySize,
      ttl: config.ttlMs,
      ttlAutopurge: false,
      allowStale: false,
      updateAgeOnGet: false,
      updateAgeOnHas: false,
      sizeCalculation: config.sizeCalculation,
      dispose: (_value, _key, reason) => {
        if (reason === "evict") {
          this.record("evict");
          this.recordSizeMetrics();
        }
      },
    });
  }

  get(key: K): V | undefined {
    if (!this.config.enabled) {
      return undefined;
    }

    const value = this.cache.get(key);
    this.record(value === undefined ? "miss" : "hit");

    return value;
  }

  set(key: K, value: V, ttlMs = this.config.ttlMs): void {
    if (!this.config.enabled) {
      return;
    }

    try {
      this.cache.set(key, value, { ttl: ttlMs });
      this.record("set");
      this.recordSizeMetrics();
    } catch (error) {
      logger.error(
        `Failed to set local cache entry for namespace ${this.config.namespace}`,
        error,
      );
    }
  }

  clear(): void {
    this.cache.clear();
    this.inflightLoads.clear();
    this.record("clear");
    this.recordSizeMetrics();
  }

  async getOrLoad(
    key: K,
    loader: () => Promise<LocalCacheLoadResult<V>>,
  ): Promise<LocalCacheLoadResult<V>> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return { value: cached, source: "local" };
    }

    if (!this.config.enabled) {
      return loader();
    }

    const inflight = this.inflightLoads.get(key);
    if (inflight) {
      this.record("inflight_join");
      return inflight;
    }

    const loadPromise = (async () => {
      const result = await loader();

      if (result.value !== undefined) {
        this.set(key, result.value, result.ttlMs);
      }

      return result;
    })();

    this.inflightLoads.set(key, loadPromise);

    try {
      return await loadPromise;
    } finally {
      this.inflightLoads.delete(key);
    }
  }

  private record(metric: string): void {
    recordIncrement(`langfuse.local_cache.${metric}`, 1, {
      namespace: this.config.namespace,
    });
  }

  private recordSizeMetrics(): void {
    recordGauge("langfuse.local_cache.size_entries", this.cache.size, {
      namespace: this.config.namespace,
    });
    recordGauge("langfuse.local_cache.size_bytes", this.cache.calculatedSize, {
      namespace: this.config.namespace,
    });
  }
}

export const getJsonEntrySize = (key: string, value: unknown): number => {
  const serializedValue = JSON.stringify(value) ?? "undefined";

  return (
    Buffer.byteLength(key, "utf8") + Buffer.byteLength(serializedValue, "utf8")
  );
};

export const kilobytesToBytes = (valueInKb: number): number => valueInKb * 1024;

export const megabytesToBytes = (valueInMb: number): number =>
  valueInMb * 1024 * 1024;
