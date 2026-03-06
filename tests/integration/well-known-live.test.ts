/**
 * Live test — fetches real .well-known/x402 documents.
 * Only runs when RUN_LIVE_TESTS=1.
 */
import { describe, it, expect } from "vitest";
import { fetchWellKnown } from "../../src/discovery/well-known.js";

const SHOULD_RUN = process.env.RUN_LIVE_TESTS === "1";

describe.skipIf(!SHOULD_RUN)("Live .well-known/x402", () => {
  it("fetches endpoints from x402.onchainexpat.com", async () => {
    const endpoints = await fetchWellKnown("https://x402.onchainexpat.com");

    expect(endpoints.length).toBeGreaterThan(0);
    expect(endpoints[0].url).toContain("x402.onchainexpat.com");
    expect(endpoints[0].method).toBe("POST");
  }, 15_000);

  it("fetches endpoints from padelmaps.org", async () => {
    const endpoints = await fetchWellKnown("https://padelmaps.org");

    expect(endpoints.length).toBeGreaterThan(0);
    expect(endpoints[0].url).toContain("padelmaps.org");
  }, 15_000);
});
