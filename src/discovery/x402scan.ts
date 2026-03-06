import { fetchWithRetry } from "../utils/http.js";
import { logger } from "../utils/logger.js";
import type { DiscoveredEndpoint } from "./well-known.js";

const X402SCAN_API = "https://www.x402scan.com";

/** Search x402scan.com for endpoints matching a query */
export async function searchX402Scan(
  query?: string,
): Promise<DiscoveredEndpoint[]> {
  try {
    const url = query
      ? `${X402SCAN_API}/api/search?q=${encodeURIComponent(query)}`
      : `${X402SCAN_API}/api/resources`;

    const response = await fetchWithRetry(url, { timeout: 10_000, retries: 1 });
    if (!response.ok) {
      logger.warn(`x402scan returned ${response.status}`);
      return [];
    }

    const data = await response.json() as any;
    const resources = Array.isArray(data) ? data : data.resources ?? data.data ?? [];

    return resources.map((r: any) => ({
      url: r.url ?? r.resource?.url ?? "",
      method: r.method ?? "POST",
      price: r.price ?? r.accepts?.[0]?.amount ?? "unknown",
      description: r.description ?? r.title ?? "",
      scheme: r.scheme ?? r.accepts?.[0]?.scheme ?? "exact",
      source: "x402scan.com",
    })).filter((e: DiscoveredEndpoint) => e.url.length > 0);
  } catch (err) {
    logger.warn(`x402scan search failed: ${err}`);
    return [];
  }
}
