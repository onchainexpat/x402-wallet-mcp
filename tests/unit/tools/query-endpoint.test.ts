import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatUsdc } from "../../../src/utils/format.js";

const probeEndpoint = vi.fn();
vi.mock("../../../src/payment/negotiator.js", () => ({ probeEndpoint }));

const base = {
  network: "eip155:8453",
  payTo: "0xd8ba61a0b0974db0ec8e325c7628470526558e9b",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

async function preview() {
  const { queryEndpointTool } = await import("../../../src/tools/query-endpoint.js");
  const out = await queryEndpointTool().handler({ url: "https://example.com/api/x" });
  return JSON.parse(out.content[0].text);
}

describe("query_endpoint price preview", () => {
  beforeEach(() => probeEndpoint.mockReset());

  it("shows the price call_endpoint would pay", async () => {
    probeEndpoint.mockResolvedValueOnce({
      x402Version: 1,
      accepts: [{ scheme: "exact", ...base, maxAmountRequired: "10000" }],
    });
    const { paymentOptions } = await preview();
    expect(paymentOptions[0].price).toBe(formatUsdc(10000n));
    expect(paymentOptions[0].priceAtomic).toBe("10000");
  });

  it("marks an exact option quoting two different prices as unpayable, not the smaller price", async () => {
    probeEndpoint.mockResolvedValueOnce({
      x402Version: 1,
      accepts: [
        { scheme: "exact", ...base, amount: "5000000000", maxAmountRequired: "1000" },
        { scheme: "exact", ...base, amount: "2000" },
      ],
    });
    const { paymentOptions } = await preview();
    expect(paymentOptions[0].price).toBe("invalid");
    expect(paymentOptions[0].priceAtomic).toBeNull();
    expect(paymentOptions[0].error).toMatch(/two different prices/);
    // one bad option does not break the others
    expect(paymentOptions[1].priceAtomic).toBe("2000");
  });

  it("says so when a 402 lists no payment options, instead of crashing", async () => {
    probeEndpoint.mockResolvedValueOnce({ x402Version: 2 });
    expect((await preview()).status).toBe("no_payment_options");
    probeEndpoint.mockResolvedValueOnce({ x402Version: 1, accepts: [] });
    expect((await preview()).status).toBe("no_payment_options");
  });

  it("does not throw on a malformed price", async () => {
    probeEndpoint.mockResolvedValueOnce({
      x402Version: 2,
      accepts: [{ scheme: "exact", ...base, amount: "-5" }],
    });
    const { paymentOptions } = await preview();
    expect(paymentOptions[0].price).toBe("invalid");
  });
});

