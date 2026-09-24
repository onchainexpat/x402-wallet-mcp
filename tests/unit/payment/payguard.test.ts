import { describe, expect, it, vi } from "vitest";
import {
  createPayGuardPreSignGate,
  type PreSignIntent,
} from "../../../src/payment/payguard.js";

const intent: PreSignIntent = {
  url: "https://merchant.example/report",
  method: "POST",
  accept: {
    scheme: "exact",
    network: "eip155:8453",
    amount: "1000000",
    payTo: "0x1111111111111111111111111111111111111111",
    asset: "0x833589fCD6eDb6E08f4C7C32D4f71b54bda02913",
  },
};

function response(
  decision: string,
  request: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Response {
  return {
    ok: true,
    status: 200,
    async json() {
      const quote = request.x402 as Record<string, string>;
      return {
        intent_id: request.intent_id,
        amount_minor: request.amount_minor,
        currency: request.currency,
        rail: request.rail,
        network: quote.network,
        asset: quote.asset.toLowerCase(),
        receipt_id: "receipt-1",
        request_hash: "request-1",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        decision,
        reasons: decision === "ALLOW" ? ["within_policy"] : ["new_provider_or_payee"],
        ...overrides,
      };
    },
  } as Response;
}

function gate(decision = "ALLOW", inspect = (_body: Record<string, unknown>) => {}) {
  return createPayGuardPreSignGate({
    token: "pgc_test",
    intentId: () => "fixed",
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      inspect(body);
      return response(decision, body);
    },
  });
}

describe("PayGuard pre-sign gate", () => {
  it("allows only an explicit receipt bound to the signer input", async () => {
    const result = await gate("ALLOW", (body) => {
      expect(body.amount_minor).toBe(1_000_000);
      expect(body.payee).toBe(intent.accept.payTo);
      expect((body.x402 as Record<string, string>).network).toBe("eip155:8453");
      expect((body.context as Record<string, string>).integration).toBe("x402-wallet-mcp");
    })(intent);
    expect(result.allowed).toBe(true);
    expect(result.receiptId).toBe("receipt-1");
  });

  it("refuses BLOCK and REQUIRE_APPROVAL before signing", async () => {
    expect((await gate("BLOCK")(intent)).allowed).toBe(false);
    expect((await gate("REQUIRE_APPROVAL")(intent)).allowed).toBe(false);
  });

  it("fails closed on network failure and invalid amount", async () => {
    const offline = createPayGuardPreSignGate({
      token: "pgc_test",
      fetchImpl: async () => { throw new Error("offline"); },
    });
    expect((await offline(intent)).reasons).toEqual(["payguard_unavailable"]);
    const invalid = await gate()({
      ...intent,
      accept: { ...intent.accept, amount: "not-a-number" },
    });
    expect(invalid.reasons).toEqual(["invalid_x402_amount"]);
  });

  it("fails closed on a mismatched or expired receipt", async () => {
    const mismatched = createPayGuardPreSignGate({
      token: "pgc_test",
      intentId: () => "fixed",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return response("ALLOW", body, { amount_minor: 2_000_000 });
      },
    });
    expect((await mismatched(intent)).reasons).toEqual(["mismatched_payguard_receipt"]);
  });

  it("fails closed on timeout", async () => {
    const timeout = createPayGuardPreSignGate({
      token: "pgc_test",
      timeoutMs: 20,
      fetchImpl: async (_url, { signal } = {}) => new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    });
    expect((await timeout(intent)).reasons).toEqual(["payguard_unavailable"]);
  });
});
