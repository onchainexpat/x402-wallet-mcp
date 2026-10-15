import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { WalletProvider } from "../../../src/wallet/types.js";
import type { TransactionEntry } from "../../../src/payment/negotiator.js";

// Offline only: fetch is mocked, the signer is a throwaway key, no chain calls or spend.
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
vi.mock("../../../src/spending/allowlist.js", () => ({
  checkMerchantAllowlist: vi.fn().mockReturnValue({ allowed: true }),
}));
vi.mock("../../../src/utils/balance.js", () => ({
  getUsdcBalance: vi.fn().mockResolvedValue(1_000_000_000n),
}));

const URL_ = "https://seller.test/api/summarize";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAY_TO = "0x" + "ab".repeat(20);
const LISTING = { price: 0.01, payTo: PAY_TO, network: "eip155:8453" };
const accept = (o: Record<string, unknown> = {}) => ({
  scheme: "exact", network: "eip155:8453", amount: "10000", asset: USDC, payTo: PAY_TO,
  maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" }, ...o,
});

function throwawayWallet(): WalletProvider & { signs: number } {
  const account = privateKeyToAccount(generatePrivateKey());
  const w = {
    signs: 0,
    mode: "privy" as const,
    getEvmAddress: () => account.address,
    signTypedData: async (domain: any, types: any, primaryType: string, message: any) => {
      w.signs++;
      return account.signTypedData({ domain, types, primaryType, message });
    },
    describe: () => ({ mode: "privy" as const, evmAddress: account.address, recoverable: false }),
  };
  return w;
}

function res(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Mock seller: 402 with `accepts`, then 200 once X-PAYMENT is sent. */
function seller(accepts: unknown[]) {
  const paid: string[] = [];
  mockFetch.mockImplementation(async (_url: string, init: RequestInit = {}) => {
    const h = new Headers(init.headers);
    if (h.get("x-payment")) { paid.push(h.get("x-payment")!); return res(200, { ok: true }); }
    return res(402, { x402Version: 2, accepts });
  });
  return paid;
}

async function call(listings: Record<string, unknown> | null, wallet: WalletProvider) {
  vi.resetModules();
  if (listings) {
    const dir = mkdtempSync(join(tmpdir(), "spotcheck-"));
    const file = join(dir, "listings.json");
    writeFileSync(file, JSON.stringify(listings));
    vi.stubEnv("X402_SPOTCHECK_LISTINGS", file);
  }
  const { makePaymentCall } = await import("../../../src/payment/negotiator.js");
  const recorded: TransactionEntry[] = [];
  return makePaymentCall(URL_, {
    wallet, checkSpendingLimit: () => ({ allowed: true }), recordTransaction: (e) => recorded.push(e),
  });
}

describe("optional x402-spotcheck pre-sign check", () => {
  beforeEach(() => { mockFetch.mockReset(); vi.unstubAllEnvs(); vi.stubEnv("X402_SPOTCHECK_LISTINGS", ""); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("is off by default: a changed recipient is still paid as before", async () => {
    const paid = seller([accept({ payTo: "0x" + "ee".repeat(20) })]);
    const w = throwawayWallet();
    const r = await call(null, w);
    expect(r.success).toBe(true);
    expect(w.signs).toBe(1);
    expect(paid).toHaveLength(1);
  });

  it("matching terms: signs once and pays", async () => {
    const paid = seller([accept()]);
    const w = throwawayWallet();
    const r = await call({ [URL_]: LISTING }, w);
    expect(r.success).toBe(true);
    expect(w.signs).toBe(1);
    expect(paid).toHaveLength(1);
  });

  for (const [amount, ok] of [["5000", true], ["10100", true], ["10101", false]] as const) {
    it(`price rule: listed $0.01, asked ${amount} atomic -> ${ok ? "pays" : "blocked"}`, async () => {
      const paid = seller([accept({ amount })]);
      const w = throwawayWallet();
      const r = await call({ [URL_]: LISTING }, w);
      expect(r.success).toBe(ok);
      expect(w.signs).toBe(ok ? 1 : 0);
      expect(paid).toHaveLength(ok ? 1 : 0);
      if (!ok) expect((r.data as any).error).toBe("spotcheck_blocked");
      if (!ok) expect(r.error).toMatch(/price_mismatch/);
    });
  }

  for (const [name, a, listing, code] of [
    ["changed recipient", accept({ payTo: "0x" + "ee".repeat(20) }), LISTING, "pay_to_mismatch"],
    ["non-USDC asset", accept({ asset: "0x" + "cd".repeat(20) }), LISTING, "asset_not_usdc"],
    ["listing on another network", accept(), { ...LISTING, network: "eip155:84532" }, "network_mismatch"],
  ] as const) {
    it(`${name}: blocked before signing (${code})`, async () => {
      const paid = seller([a]);
      const w = throwawayWallet();
      const r = await call({ [URL_]: listing }, w);
      expect(r.success).toBe(false);
      expect(r.error).toMatch(code);
      expect(w.signs).toBe(0);
      expect(paid).toHaveLength(0);
    });
  }

  it("fails open: no listing for the URL", async () => {
    const paid = seller([accept({ payTo: "0x" + "ee".repeat(20) })]);
    const w = throwawayWallet();
    const r = await call({ "https://other.test/x": LISTING }, w);
    expect(r.success).toBe(true);
    expect(paid).toHaveLength(1);
  });

  it("fails open: networks other than Base mainnet are not judged", async () => {
    const paid = seller([accept({ network: "eip155:84532", asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" })]);
    const w = throwawayWallet();
    const r = await call({ [URL_]: { ...LISTING, price: 0.000001 } }, w);
    expect(r.success).toBe(true);
    expect(paid).toHaveLength(1);
  });

  it("fails open: unreadable listings file", async () => {
    const paid = seller([accept()]);
    vi.stubEnv("X402_SPOTCHECK_LISTINGS", "/nonexistent/listings.json");
    const w = throwawayWallet();
    const r = await call(null, w);
    expect(r.success).toBe(true);
    expect(paid).toHaveLength(1);
  });

  it("fails open: package missing or hook error", async () => {
    const { createSpotCheckGate } = await import("../../../src/payment/spotcheck.js");
    const input = { url: URL_, method: "POST", accept: accept() as any, paymentRequired: { x402Version: 2, accepts: [] } };
    const missing = createSpotCheckGate({ listings: { [URL_]: LISTING }, load: () => Promise.reject(new Error("Cannot find module")) });
    expect(await missing(input)).toEqual({ allowed: true });
    const throwing = createSpotCheckGate({ listings: {}, load: async () => ({ spotCheckBeforePaymentHook: () => { throw new Error("boom"); } }) });
    expect(await throwing(input)).toEqual({ allowed: true });
  });

  it("uses x402-spotcheck 1.0.0 in local mode (no fetch from the check)", async () => {
    const m = await import("x402-spotcheck");
    expect(m.VERSION).toBe("1.0.0");
    seller([accept()]);
    await call({ [URL_]: LISTING }, throwawayWallet());
    expect(mockFetch.mock.calls.every(([u]) => u === URL_)).toBe(true);
  });
});
