import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WalletProvider } from "../../../src/wallet/types.js";
import type { TransactionEntry } from "../../../src/payment/negotiator.js";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock the signing modules to avoid real crypto
vi.mock("../../../src/payment/evm-exact.js", () => ({
  signExactPayment: vi.fn().mockResolvedValue("bW9ja2VkLXBheW1lbnQ="),
}));
vi.mock("../../../src/payment/evm-escrow.js", () => ({
  signEscrowPayment: vi.fn().mockResolvedValue("bW9ja2VkLWVzY3Jvdw=="),
}));
// Mock allowlist to always allow — negotiator tests focus on payment flow
vi.mock("../../../src/spending/allowlist.js", () => ({
  checkMerchantAllowlist: vi.fn().mockReturnValue({ allowed: true }),
}));
// Mock the pre-flight balance check so it doesn't issue its own RPC fetch,
// which would otherwise consume a queued mockFetch response meant for the paid retry.
vi.mock("../../../src/utils/balance.js", () => ({
  getUsdcBalance: vi.fn().mockResolvedValue(1_000_000_000n),
}));

function createMockWallet(): WalletProvider {
  return {
    mode: "privy",
    getEvmAddress: () => "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    signTypedData: vi.fn().mockResolvedValue("0x" + "ab".repeat(65)),
    describe: () => ({
      mode: "privy",
      evmAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      recoverable: true,
    }),
  };
}

function makeResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

describe("negotiator: makePaymentCall", () => {
  let recorded: TransactionEntry[];

  beforeEach(() => {
    recorded = [];
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns data directly if endpoint is not 402", async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse(200, { result: "free data" }),
    );

    const { makePaymentCall } = await import("../../../src/payment/negotiator.js");
    const result = await makePaymentCall("https://example.com/api/free", {
      wallet: createMockWallet(),
      checkSpendingLimit: () => ({ allowed: true }),
      recordTransaction: (e) => recorded.push(e),
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ result: "free data" });
    expect(recorded).toHaveLength(0);
  });

  it("handles 402 → sign → retry → 200 flow", async () => {
    // First call: 402 with payment requirements
    mockFetch.mockResolvedValueOnce(
      makeResponse(402, {
        x402Version: 1,
        accepts: [
          {
            scheme: "exact",
            network: "eip155:8453",
            amount: "2000",
            payTo: "0xd8bA61a0b0974db0EC8E325C7628470526558E9B",
            asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            maxTimeoutSeconds: 60,
            extra: { name: "USD Coin", version: "2" },
          },
        ],
      }),
    );
    // Second call: 200 with data
    mockFetch.mockResolvedValueOnce(
      makeResponse(200, { stories: ["HN story 1"] }),
    );

    const { makePaymentCall } = await import("../../../src/payment/negotiator.js");
    const result = await makePaymentCall("https://example.com/api/paid", {
      wallet: createMockWallet(),
      checkSpendingLimit: () => ({ allowed: true }),
      recordTransaction: (e) => recorded.push(e),
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect(result.amountPaid).toBe(2000n);
    expect(result.scheme).toBe("exact");

    // Verify two fetch calls were made
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Verify second call included X-PAYMENT header
    const secondCall = mockFetch.mock.calls[1];
    const secondHeaders = secondCall[1]?.headers as Record<string, string>;
    expect(secondHeaders).toBeDefined();
    expect(secondHeaders["X-PAYMENT"]).toBeDefined();
    expect(secondHeaders["X-PAYMENT"].length).toBeGreaterThan(0);

    // Transaction recorded
    expect(recorded).toHaveLength(1);
    expect(recorded[0].status).toBe("success");
    expect(recorded[0].amount).toBe("2000");
  });

  it("uses PAYMENT-SIGNATURE for an x402 v2 exact paid retry", async () => {
    const challenge = {
      x402Version: 2,
      accepts: [{
        scheme: "exact", network: "eip155:8453", amount: "5000",
        payTo: "0xa9a52a066e342e2ED2488BBdb9fAd95EFd3D9FD4",
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        extra: { name: "USD Coin", version: "2" },
      }],
      resource: { url: "https://example.com/v1/preflight" },
    };
    mockFetch.mockResolvedValueOnce(makeResponse(402, challenge, {
      "PAYMENT-REQUIRED": btoa(JSON.stringify(challenge)),
    })).mockResolvedValueOnce(makeResponse(200, { importReady: true }));
    const { makePaymentCall } = await import("../../../src/payment/negotiator.js");
    const result = await makePaymentCall("https://example.com/v1/preflight", {
      wallet: createMockWallet(), checkSpendingLimit: () => ({ allowed: true }),
      recordTransaction: (e) => recorded.push(e),
      body: JSON.stringify({ csv: "id\n1\n" }),
    });
    expect(result.success).toBe(true);
    const headers = mockFetch.mock.calls[1][1].headers as Record<string, string>;
    expect(headers["PAYMENT-SIGNATURE"]).toBeDefined();
    expect(headers["X-PAYMENT"]).toBeUndefined();
    expect(recorded).toHaveLength(1);
  });

  it("rejects when spending limit is exceeded", async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse(402, {
        x402Version: 1,
        accepts: [
          {
            scheme: "exact",
            network: "eip155:8453",
            amount: "10000000",
            payTo: "0xaaa",
            asset: "0xbbb",
            extra: {},
          },
        ],
      }),
    );

    const { makePaymentCall } = await import("../../../src/payment/negotiator.js");
    const result = await makePaymentCall("https://example.com/api/expensive", {
      wallet: createMockWallet(),
      checkSpendingLimit: () => ({ allowed: false, reason: "Over daily cap" }),
      recordTransaction: (e) => recorded.push(e),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Over daily cap");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(recorded).toHaveLength(0);
  });

  it("handles double-402 (payment rejected by server)", async () => {
    mockFetch
      .mockResolvedValueOnce(
        makeResponse(402, {
          x402Version: 1,
          accepts: [
            {
              scheme: "exact",
              network: "eip155:8453",
              amount: "2000",
              payTo: "0xaaa",
              asset: "0xbbb",
              extra: {},
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        makeResponse(402, { error: "insufficient_balance" }),
      );

    const { makePaymentCall } = await import("../../../src/payment/negotiator.js");
    const result = await makePaymentCall("https://example.com/api/paid", {
      wallet: createMockWallet(),
      checkSpendingLimit: () => ({ allowed: true }),
      recordTransaction: (e) => recorded.push(e),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Payment rejected by server");
    expect(recorded).toHaveLength(1);
    expect(recorded[0].status).toBe("failed");
  });

  it("handles 402 with no accepts array", async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse(402, { error: "payment required" }),
    );

    const { makePaymentCall } = await import("../../../src/payment/negotiator.js");
    const result = await makePaymentCall("https://example.com/api/broken", {
      wallet: createMockWallet(),
      checkSpendingLimit: () => ({ allowed: true }),
      recordTransaction: (e) => recorded.push(e),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("no payment options");
  });

  it("handles 402 with empty accepts array", async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse(402, { x402Version: 1, accepts: [] }),
    );

    const { makePaymentCall } = await import("../../../src/payment/negotiator.js");
    const result = await makePaymentCall("https://example.com/api/empty", {
      wallet: createMockWallet(),
      checkSpendingLimit: () => ({ allowed: true }),
      recordTransaction: (e) => recorded.push(e),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("no payment options");
  });

  it("parses payment info from PAYMENT-REQUIRED header", async () => {
    const paymentRequired = {
      x402Version: 1,
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          amount: "5000",
          payTo: "0xaaa",
          asset: "0xbbb",
          extra: { name: "USD Coin", version: "2" },
        },
      ],
    };
    const headerValue = btoa(JSON.stringify(paymentRequired));

    mockFetch
      .mockResolvedValueOnce(
        makeResponse(402, {}, { "payment-required": headerValue }),
      )
      .mockResolvedValueOnce(
        makeResponse(200, { result: "ok" }),
      );

    const { makePaymentCall } = await import("../../../src/payment/negotiator.js");
    const result = await makePaymentCall("https://example.com/api/header", {
      wallet: createMockWallet(),
      checkSpendingLimit: () => ({ allowed: true }),
      recordTransaction: (e) => recorded.push(e),
    });

    expect(result.success).toBe(true);
    expect(result.amountPaid).toBe(5000n);
  });

  it("prefers EVM exact over escrow by default", async () => {
    const { signExactPayment } = await import("../../../src/payment/evm-exact.js");
    const { signEscrowPayment } = await import("../../../src/payment/evm-escrow.js");

    mockFetch
      .mockResolvedValueOnce(
        makeResponse(402, {
          x402Version: 1,
          accepts: [
            {
              scheme: "escrow",
              network: "eip155:8453",
              amount: "4000",
              payTo: "0xaaa",
              asset: "0xbbb",
              extra: { operatorAddress: "0xccc", tokenCollector: "0xddd" },
            },
            {
              scheme: "exact",
              network: "eip155:8453",
              amount: "2000",
              payTo: "0xaaa",
              asset: "0xbbb",
              extra: {},
            },
          ],
        }),
      )
      .mockResolvedValueOnce(makeResponse(200, { ok: true }));

    const { makePaymentCall } = await import("../../../src/payment/negotiator.js");
    await makePaymentCall("https://example.com/api/both", {
      wallet: createMockWallet(),
      checkSpendingLimit: () => ({ allowed: true }),
      recordTransaction: () => {},
    });

    expect(signExactPayment).toHaveBeenCalled();
    expect(signEscrowPayment).not.toHaveBeenCalled();
  });

  it("prefers escrow when preferEscrow=true", async () => {
    const { signEscrowPayment } = await import("../../../src/payment/evm-escrow.js");

    mockFetch
      .mockResolvedValueOnce(
        makeResponse(402, {
          x402Version: 1,
          accepts: [
            {
              scheme: "exact",
              network: "eip155:8453",
              amount: "2000",
              payTo: "0xaaa",
              asset: "0xbbb",
              extra: {},
            },
            {
              scheme: "escrow",
              network: "eip155:8453",
              amount: "4000",
              payTo: "0xaaa",
              asset: "0xbbb",
              extra: { operatorAddress: "0xccc", tokenCollector: "0xddd" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(makeResponse(200, { ok: true }));

    const { makePaymentCall } = await import("../../../src/payment/negotiator.js");
    await makePaymentCall("https://example.com/api/prefer-escrow", {
      wallet: createMockWallet(),
      checkSpendingLimit: () => ({ allowed: true }),
      recordTransaction: () => {},
      preferEscrow: true,
    });

    expect(signEscrowPayment).toHaveBeenCalled();
  });

  it("pays a commerce-only option through the escrow signer", async () => {
    const { signEscrowPayment } = await import("../../../src/payment/evm-escrow.js");
    mockFetch
      .mockResolvedValueOnce(
        makeResponse(402, {
          x402Version: 2,
          accepts: [
            {
              scheme: "commerce",
              network: "eip155:8453",
              amount: "10000",
              payTo: "0xaaa",
              asset: "0xbbb",
              extra: { operatorAddress: "0xccc", tokenCollector: "0xddd" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(makeResponse(200, { ok: true }));

    const { makePaymentCall } = await import("../../../src/payment/negotiator.js");
    const result = await makePaymentCall("https://example.com/api/commerce", {
      wallet: createMockWallet(),
      checkSpendingLimit: () => ({ allowed: true }),
      recordTransaction: (e) => recorded.push(e),
    });

    expect(result.success).toBe(true);
    expect(result.scheme).toBe("commerce");
    expect(signEscrowPayment).toHaveBeenCalledTimes(1);
    expect(recorded[0].scheme).toBe("commerce");
  });

  it("pays an exact-labelled offer with x402r commerce terms as commerce", async () => {
    const { signEscrowPayment } = await import("../../../src/payment/evm-escrow.js");
    const { signExactPayment } = await import("../../../src/payment/evm-exact.js");
    mockFetch
      .mockResolvedValueOnce(makeResponse(402, { x402Version: 2, accepts: [{
            scheme: "exact",
            network: "eip155:8453",
            amount: "10000",
            payTo: "0xd8bA61a0b0974db0EC8E325C7628470526558E9B",
            asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            maxTimeoutSeconds: 60,
            extra: {
              name: "USD Coin",
              version: "2",
              operatorAddress: "0x1A602eEC594BD9A50D8FD06BCC13D35c18FE68A8",
              escrowAddress: "0xb9488351E48b23D798f24e8174514F28B741Eb4f",
              tokenCollector: "0x48ADf6E37F9b31dC2AAD0462C5862B5422C736B8",
              minFeeBps: 0,
              maxFeeBps: 1000,
            },
          }] }))
      .mockResolvedValueOnce(makeResponse(200, { ok: true }));

    const { makePaymentCall } = await import("../../../src/payment/negotiator.js");
    const result = await makePaymentCall("https://padelmaps.org/api/x402r/countries", {
      wallet: createMockWallet(),
      checkSpendingLimit: () => ({ allowed: true }),
      recordTransaction: (e) => recorded.push(e),
    });

    expect(result.success).toBe(true);
    expect(signEscrowPayment).toHaveBeenCalledTimes(1);
    expect(signExactPayment).not.toHaveBeenCalled();
    expect((signEscrowPayment as any).mock.calls[0][1].scheme).toBe("commerce");
    expect(recorded[0].scheme).toBe("commerce");
  });

  it("still pays a plain exact offer as exact", async () => {
    const { signEscrowPayment } = await import("../../../src/payment/evm-escrow.js");
    const { signExactPayment } = await import("../../../src/payment/evm-exact.js");
    mockFetch
      .mockResolvedValueOnce(
        makeResponse(402, {
          x402Version: 2,
          accepts: [{ scheme: "exact", network: "eip155:8453", amount: "10000", payTo: "0xaaa", asset: "0xbbb", extra: { name: "USD Coin", version: "2" } }],
        }),
      )
      .mockResolvedValueOnce(makeResponse(200, { ok: true }));

    const { makePaymentCall } = await import("../../../src/payment/negotiator.js");
    await makePaymentCall("https://padelmaps.org/api/x402/countries", {
      wallet: createMockWallet(),
      checkSpendingLimit: () => ({ allowed: true }),
      recordTransaction: (e) => recorded.push(e),
    });

    expect(signExactPayment).toHaveBeenCalledTimes(1);
    expect(signEscrowPayment).not.toHaveBeenCalled();
    expect(recorded[0].scheme).toBe("exact");
  });

  it("records non-200 paid responses as failed", async () => {
    mockFetch
      .mockResolvedValueOnce(
        makeResponse(402, {
          x402Version: 1,
          accepts: [
            { scheme: "exact", network: "eip155:8453", amount: "2000", payTo: "0xaaa", asset: "0xbbb", extra: {} },
          ],
        }),
      )
      .mockResolvedValueOnce(
        makeResponse(500, { error: "internal error" }),
      );

    const { makePaymentCall } = await import("../../../src/payment/negotiator.js");
    const result = await makePaymentCall("https://example.com/api/error", {
      wallet: createMockWallet(),
      checkSpendingLimit: () => ({ allowed: true }),
      recordTransaction: (e) => recorded.push(e),
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(500);
    expect(result.amountPaid).toBe(0n);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].status).toBe("failed");
    expect(recorded[0].error).toBe("HTTP 500");
  });

  it("uses maxAmountRequired when present", async () => {
    mockFetch
      .mockResolvedValueOnce(
        makeResponse(402, {
          x402Version: 2,
          accepts: [
            {
              scheme: "escrow",
              network: "eip155:8453",
              amount: "2000",
              maxAmountRequired: "4000",
              payTo: "0xaaa",
              asset: "0xbbb",
              extra: { operatorAddress: "0xccc", tokenCollector: "0xddd" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(makeResponse(200, { ok: true }));

    const { makePaymentCall } = await import("../../../src/payment/negotiator.js");
    const result = await makePaymentCall("https://example.com/api/escrow", {
      wallet: createMockWallet(),
      checkSpendingLimit: (amount) => {
        expect(amount).toBe(4000n);
        return { allowed: true };
      },
      recordTransaction: () => {},
    });

    expect(result.success).toBe(true);
    expect(result.amountPaid).toBe(4000n);
  });

  it("refuses, without signing, an exact option quoting two different prices", async () => {
    const { signExactPayment } = await import("../../../src/payment/evm-exact.js");
    mockFetch.mockResolvedValueOnce(
      makeResponse(402, {
        x402Version: 1,
        accepts: [
          {
            scheme: "exact",
            network: "eip155:8453",
            amount: "5000000000",
            maxAmountRequired: "1000",
            payTo: "0xd8ba61a0b0974db0ec8e325c7628470526558e9b",
            asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          },
        ],
      }),
    );

    const { makePaymentCall } = await import("../../../src/payment/negotiator.js");
    const checkSpendingLimit = vi.fn().mockReturnValue({ allowed: true });
    const result = await makePaymentCall("https://example.com/api/decoy", {
      wallet: createMockWallet(),
      checkSpendingLimit,
      recordTransaction: (e) => recorded.push(e),
    });

    expect(result.success).toBe(false);
    expect((result.data as { error: string }).error).toBe("invalid_payment_terms");
    expect(signExactPayment).not.toHaveBeenCalled();
    expect(checkSpendingLimit).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(recorded).toHaveLength(0);
  });

  it("refuses when the paid request quotes more than the approved price", async () => {
    const { signExactPayment } = await import("../../../src/payment/evm-exact.js");
    mockFetch.mockResolvedValueOnce(
      makeResponse(402, {
        x402Version: 2,
        accepts: [
          {
            scheme: "exact",
            network: "eip155:8453",
            amount: "4990000", // $4.99, under the per-call cap
            payTo: "0xd8ba61a0b0974db0ec8e325c7628470526558e9b",
            asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          },
        ],
      }),
    );

    const { makePaymentCall } = await import("../../../src/payment/negotiator.js");
    const result = await makePaymentCall("https://example.com/api/bait", {
      wallet: createMockWallet(),
      checkSpendingLimit: () => ({ allowed: true }),
      recordTransaction: (e) => recorded.push(e),
      maxApprovedAtomic: 10000n, // the probe quoted $0.01
    });

    expect(result.success).toBe(false);
    expect((result.data as { error: string }).error).toBe("price_changed");
    expect(signExactPayment).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("handles network error during initial request", async () => {
    mockFetch.mockRejectedValueOnce(new Error("connection refused"));

    const { makePaymentCall } = await import("../../../src/payment/negotiator.js");

    await expect(
      makePaymentCall("https://example.com/api/down", {
        wallet: createMockWallet(),
        checkSpendingLimit: () => ({ allowed: true }),
        recordTransaction: () => {},
      }),
    ).rejects.toThrow("connection refused");
  });
});

describe("negotiator: probeEndpoint", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns payment info for 402 endpoints", async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse(402, {
        x402Version: 1,
        accepts: [{ scheme: "exact", network: "eip155:8453", amount: "2000" }],
      }),
    );

    const { probeEndpoint } = await import("../../../src/payment/negotiator.js");
    const result = await probeEndpoint("https://example.com/api/paid");

    expect(result).not.toBeNull();
    expect(result!.accepts).toHaveLength(1);
    expect(result!.accepts[0].amount).toBe("2000");
  });

  it("returns null for free endpoints", async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse(200, { result: "free" }),
    );

    const { probeEndpoint } = await import("../../../src/payment/negotiator.js");
    const result = await probeEndpoint("https://example.com/api/free");

    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));

    const { probeEndpoint } = await import("../../../src/payment/negotiator.js");
    const result = await probeEndpoint("https://example.com/api/broken");

    expect(result).toBeNull();
  });

  it("parses PAYMENT-REQUIRED header for probe", async () => {
    const paymentRequired = {
      x402Version: 1,
      accepts: [
        { scheme: "exact", network: "eip155:8453", amount: "3000", payTo: "0xaaa" },
      ],
    };

    mockFetch.mockResolvedValueOnce(
      makeResponse(402, {}, { "payment-required": btoa(JSON.stringify(paymentRequired)) }),
    );

    const { probeEndpoint } = await import("../../../src/payment/negotiator.js");
    const result = await probeEndpoint("https://example.com/api/header-probe");

    expect(result).not.toBeNull();
    expect(result!.accepts[0].amount).toBe("3000");
  });

  it("turns paymentOptions into accepts (body)", async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse(402, {
        x402Version: 2,
        paymentOptions: [
          { scheme: "exact", network: "eip155:8453", priceAtomic: "7000", payTo: "0xaaa", asset: "0xbbb" },
        ],
      }),
    );

    const { probeEndpoint } = await import("../../../src/payment/negotiator.js");
    const result = await probeEndpoint("https://example.com/api/v2-body");

    expect(result!.accepts).toHaveLength(1);
    expect(result!.accepts[0]).toMatchObject({ scheme: "exact", amount: "7000", payTo: "0xaaa" });
  });

  it("turns paymentOptions into accepts (PAYMENT-REQUIRED header)", async () => {
    const paymentRequired = {
      x402Version: 2,
      paymentOptions: [{ network: "eip155:8453", amount: "8000", payTo: "0xaaa" }],
    };
    mockFetch.mockResolvedValueOnce(
      makeResponse(402, {}, { "payment-required": btoa(JSON.stringify(paymentRequired)) }),
    );

    const { probeEndpoint } = await import("../../../src/payment/negotiator.js");
    const result = await probeEndpoint("https://example.com/api/v2-header");

    expect(result!.accepts[0]).toMatchObject({ scheme: "exact", amount: "8000" });
  });

  it("reports an exact-labelled offer with x402r commerce terms as commerce", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(402, { x402Version: 2, accepts: [{
            scheme: "exact",
            network: "eip155:8453",
            amount: "10000",
            payTo: "0xd8bA61a0b0974db0EC8E325C7628470526558E9B",
            asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            maxTimeoutSeconds: 60,
            extra: {
              name: "USD Coin",
              version: "2",
              operatorAddress: "0x1A602eEC594BD9A50D8FD06BCC13D35c18FE68A8",
              escrowAddress: "0xb9488351E48b23D798f24e8174514F28B741Eb4f",
              tokenCollector: "0x48ADf6E37F9b31dC2AAD0462C5862B5422C736B8",
              minFeeBps: 0,
              maxFeeBps: 1000,
            },
          }] }));

    const { probeEndpoint } = await import("../../../src/payment/negotiator.js");
    const result = await probeEndpoint("https://padelmaps.org/api/x402r/countries");

    expect(result!.accepts[0].scheme).toBe("commerce");
  });
});
