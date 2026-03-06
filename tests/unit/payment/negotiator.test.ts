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
});
