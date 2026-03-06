import { fetchWithRetry } from "../utils/http.js";
import { logger } from "../utils/logger.js";

export interface DiscoveredEndpoint {
  url: string;
  method: string;
  price: string;
  description: string;
  scheme: string;
  source: string;
}

export interface WellKnownResponse {
  /** v2 format: array of endpoint objects with path, method, price, etc. */
  endpoints?: Array<{
    path: string;
    method?: string;
    price?: string;
    description?: string;
    scheme?: string;
  }>;
  /** v1 format: array of full URL strings */
  resources?: string[];
  [key: string]: unknown;
}

/** Fetch .well-known/x402 from a base URL */
export async function fetchWellKnown(
  baseUrl: string,
): Promise<DiscoveredEndpoint[]> {
  const cleanBase = baseUrl.replace(/\/$/, "");
  const url = `${cleanBase}/.well-known/x402`;
  logger.debug(`Fetching ${url}...`);

  try {
    const response = await fetchWithRetry(url, { timeout: 10_000, retries: 1 });
    if (!response.ok) {
      logger.warn(`${url} returned ${response.status}`);
      return [];
    }

    const data = (await response.json()) as WellKnownResponse;

    // v2 format: endpoints array with path/method/price objects
    if (data.endpoints && Array.isArray(data.endpoints)) {
      return data.endpoints.map((ep) => ({
        url: `${cleanBase}${ep.path}`,
        method: ep.method ?? "POST",
        price: ep.price ?? "unknown",
        description: ep.description ?? "",
        scheme: ep.scheme ?? "exact",
        source: baseUrl,
      }));
    }

    // v1 format: resources array of full URL strings
    if (data.resources && Array.isArray(data.resources)) {
      return data.resources
        .filter((r): r is string => typeof r === "string" && r.startsWith("http"))
        .map((resourceUrl) => {
          // Extract a short description from the URL path
          const path = new URL(resourceUrl).pathname;
          const parts = path.split("/").filter(Boolean);
          const description = parts.slice(-1)[0]?.replace(/-/g, " ") ?? "";

          return {
            url: resourceUrl,
            method: "POST",
            price: "unknown",
            description,
            scheme: "exact",
            source: baseUrl,
          };
        });
    }

    logger.warn(`${url} has no endpoints or resources array`);
    return [];
  } catch (err) {
    logger.warn(`Failed to fetch ${url}: ${err}`);
    return [];
  }
}
