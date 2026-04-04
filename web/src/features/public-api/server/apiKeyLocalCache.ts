import { env } from "@/src/env.mjs";
import {
  LocalCache,
  OrgEnrichedApiKey,
  getJsonEntrySize,
  kilobytesToBytes,
  megabytesToBytes,
} from "@langfuse/shared/src/server";
import { type z } from "zod";

type CachedOrgEnrichedApiKey = z.infer<typeof OrgEnrichedApiKey>;

// Keep auth metadata process-local only for a brief period to cut Redis round
// trips on ingestion spikes without adding local invalidation machinery.
const apiKeyLocalCache = new LocalCache<string, CachedOrgEnrichedApiKey>({
  namespace: "api_key",
  enabled: env.LANGFUSE_LOCAL_CACHE_API_KEY_ENABLED === "true",
  ttlMs: env.LANGFUSE_LOCAL_CACHE_API_KEY_TTL_MS,
  max: env.LANGFUSE_LOCAL_CACHE_API_KEY_MAX,
  maxSize: megabytesToBytes(env.LANGFUSE_LOCAL_CACHE_API_KEY_MAX_SIZE_MB),
  maxEntrySize: kilobytesToBytes(
    env.LANGFUSE_LOCAL_CACHE_API_KEY_MAX_ENTRY_SIZE_KB,
  ),
  sizeCalculation: (value, key) => getJsonEntrySize(key, value),
});

const createLocalCacheKey = (hash: string) => `api-key:${hash}`;

export const getApiKeyFromLocalCache = (
  hash: string,
): CachedOrgEnrichedApiKey | undefined => {
  return apiKeyLocalCache.get(createLocalCacheKey(hash));
};

export const setApiKeyInLocalCache = (
  hash: string,
  apiKey: CachedOrgEnrichedApiKey,
): void => {
  apiKeyLocalCache.set(createLocalCacheKey(hash), apiKey);
};

export const clearApiKeyLocalCache = (): void => {
  apiKeyLocalCache.clear();
};
