import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { getEndpointsCachePath } from "../store/paths.js";
import { loadConfig } from "../store/config.js";
import { fetchWellKnown, type DiscoveredEndpoint } from "./well-known.js";
import { searchX402Scan } from "./x402scan.js";
import { logger } from "../utils/logger.js";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  timestamp: number;
  endpoints: DiscoveredEndpoint[];
}

function loadCache(): CacheEntry | null {
  const path = getEndpointsCachePath();
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as CacheEntry;
    if (Date.now() - raw.timestamp > CACHE_TTL_MS) return null;
    return raw;
  } catch {
    return null;
  }
}

function saveCache(endpoints: DiscoveredEndpoint[]): void {
  const entry: CacheEntry = { timestamp: Date.now(), endpoints };
  writeFileSync(getEndpointsCachePath(), JSON.stringify(entry), { mode: 0o600 });
}

/** Deduplicate endpoints by URL */
function dedup(endpoints: DiscoveredEndpoint[]): DiscoveredEndpoint[] {
  const seen = new Map<string, DiscoveredEndpoint>();
  for (const ep of endpoints) {
    const key = `${ep.method}:${ep.url}`;
    if (!seen.has(key)) {
      seen.set(key, ep);
    }
  }
  return Array.from(seen.values());
}

/** Discover endpoints from all configured sources */
export async function discoverEndpoints(
  query?: string,
  forceRefresh: boolean = false,
): Promise<DiscoveredEndpoint[]> {
  // Check cache first
  if (!forceRefresh && !query) {
    const cached = loadCache();
    if (cached) {
      logger.debug(`Using cached endpoints (${cached.endpoints.length} entries)`);
      return cached.endpoints;
    }
  }

  const config = loadConfig();
  const allEndpoints: DiscoveredEndpoint[] = [];

  // Include custom endpoints (added manually by user)
  for (const custom of config.customEndpoints ?? []) {
    const path = new URL(custom.url).pathname;
    const parts = path.split("/").filter(Boolean);
    allEndpoints.push({
      url: custom.url,
      method: "POST",
      price: "unknown",
      description: custom.description ?? parts.slice(-1)[0]?.replace(/-/g, " ") ?? "",
      scheme: "exact",
      source: "custom",
    });
  }

  // Fetch from all .well-known sources
  const wellKnownPromises = config.endpointSources.map((source) =>
    fetchWellKnown(source),
  );
  const wellKnownResults = await Promise.allSettled(wellKnownPromises);
  for (const result of wellKnownResults) {
    if (result.status === "fulfilled") {
      allEndpoints.push(...result.value);
    }
  }

  // Search x402scan
  try {
    const scanResults = await searchX402Scan(query);
    allEndpoints.push(...scanResults);
  } catch {
    // Non-fatal
  }

  const deduped = dedup(allEndpoints);

  // Cache if not a query-specific search and we found results
  if (!query && deduped.length > 0) {
    saveCache(deduped);
  }

  // Filter by query if provided (word-based: any word can match URL or description)
  if (query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return deduped;

    // Score each endpoint by how many query words match
    const scored = deduped
      .map((ep) => {
        const haystack = `${ep.url} ${ep.description}`.toLowerCase();
        const hits = words.filter((w) => haystack.includes(w)).length;
        return { ep, hits };
      })
      .filter(({ hits }) => hits > 0)
      .sort((a, b) => b.hits - a.hits);

    return scored.map(({ ep }) => ep);
  }

  return deduped;
}
