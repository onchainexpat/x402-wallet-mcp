import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiscoveredEndpoint } from "../../../src/discovery/well-known.js";

let tempDir: string;

vi.mock("../../../src/store/paths.js", () => ({
  getDataDir: () => tempDir,
  getConfigPath: () => join(tempDir, "config.json"),
  getHistoryPath: () => join(tempDir, "history.jsonl"),
  getSpendingPath: () => join(tempDir, "spending.json"),
  getEndpointsCachePath: () => join(tempDir, "endpoints-cache.json"),
}));

const wellKnownEndpoints: DiscoveredEndpoint[] = [
  {
    url: "https://example.com/api/crypto/price",
    method: "POST",
    price: "$0.002",
    description: "Crypto price",
    scheme: "exact",
    source: "https://example.com",
  },
  {
    url: "https://example.com/api/weather",
    method: "POST",
    price: "$0.005",
    description: "Weather data",
    scheme: "exact",
    source: "https://example.com",
  },
];

const x402scanEndpoints: DiscoveredEndpoint[] = [
  {
    url: "https://other.com/api/news",
    method: "POST",
    price: "$0.01",
    description: "News search",
    scheme: "exact",
    source: "x402scan.com",
  },
  // Duplicate from well-known (should be deduped)
  {
    url: "https://example.com/api/crypto/price",
    method: "POST",
    price: "$0.002",
    description: "Crypto price (from scan)",
    scheme: "exact",
    source: "x402scan.com",
  },
];

vi.mock("../../../src/discovery/well-known.js", () => ({
  fetchWellKnown: vi.fn().mockImplementation(() => Promise.resolve([...wellKnownEndpoints])),
}));

vi.mock("../../../src/discovery/x402scan.js", () => ({
  searchX402Scan: vi.fn().mockImplementation(() => Promise.resolve([...x402scanEndpoints])),
}));

describe("discovery registry", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "x402-discovery-test-"));
    writeFileSync(
      join(tempDir, "config.json"),
      JSON.stringify({
        version: 1,
        wallet: { mode: "privy" },
        spending: { perCallMaxUsdc: "5.00", dailyCapUsdc: "50.00" },
        endpointSources: ["https://example.com"],
        preferences: { preferEscrow: false, preferredNetwork: "evm" },
      }),
    );
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
    vi.clearAllMocks();
  });

  it("merges endpoints from well-known and x402scan", async () => {
    const { discoverEndpoints } = await import(
      "../../../src/discovery/registry.js"
    );
    const endpoints = await discoverEndpoints(undefined, true);

    // 2 from well-known + 1 unique from x402scan (1 deduped)
    expect(endpoints).toHaveLength(3);
    const urls = endpoints.map((e) => e.url);
    expect(urls).toContain("https://example.com/api/crypto/price");
    expect(urls).toContain("https://example.com/api/weather");
    expect(urls).toContain("https://other.com/api/news");
  });

  it("deduplicates by method:url", async () => {
    const { discoverEndpoints } = await import(
      "../../../src/discovery/registry.js"
    );
    const endpoints = await discoverEndpoints(undefined, true);

    const priceEntries = endpoints.filter((e) =>
      e.url.includes("crypto/price"),
    );
    expect(priceEntries).toHaveLength(1);
    // First one wins (from well-known)
    expect(priceEntries[0].source).toBe("https://example.com");
  });

  it("filters by query string", async () => {
    const { discoverEndpoints } = await import(
      "../../../src/discovery/registry.js"
    );
    const endpoints = await discoverEndpoints("weather");

    expect(endpoints.length).toBeGreaterThan(0);
    expect(
      endpoints.every(
        (e) =>
          e.url.toLowerCase().includes("weather") ||
          e.description.toLowerCase().includes("weather"),
      ),
    ).toBe(true);
  });

  it("uses cache for subsequent calls", async () => {
    const { fetchWellKnown } = await import(
      "../../../src/discovery/well-known.js"
    );
    const { discoverEndpoints } = await import(
      "../../../src/discovery/registry.js"
    );

    // First call: fetches from sources
    await discoverEndpoints(undefined, true);
    const callCount1 = vi.mocked(fetchWellKnown).mock.calls.length;

    // Second call: should use cache (no forceRefresh)
    await discoverEndpoints();
    const callCount2 = vi.mocked(fetchWellKnown).mock.calls.length;

    expect(callCount2).toBe(callCount1);
  });

  it("bypasses cache with forceRefresh", async () => {
    const { fetchWellKnown } = await import(
      "../../../src/discovery/well-known.js"
    );
    const { discoverEndpoints } = await import(
      "../../../src/discovery/registry.js"
    );

    await discoverEndpoints(undefined, true);
    const callCount1 = vi.mocked(fetchWellKnown).mock.calls.length;

    await discoverEndpoints(undefined, true);
    const callCount2 = vi.mocked(fetchWellKnown).mock.calls.length;

    expect(callCount2).toBeGreaterThan(callCount1);
  });

  it("handles well-known fetch failure gracefully", async () => {
    const { fetchWellKnown } = await import(
      "../../../src/discovery/well-known.js"
    );
    // Override to reject for this test only
    vi.mocked(fetchWellKnown).mockRejectedValueOnce(new Error("network error"));

    const { discoverEndpoints } = await import(
      "../../../src/discovery/registry.js"
    );
    // x402scan still works, so we should get its unique endpoints
    const endpoints = await discoverEndpoints(undefined, true);

    // The well-known Promise.allSettled catches the rejection, so x402scan results come through
    expect(endpoints.length).toBeGreaterThan(0);
  });
});
