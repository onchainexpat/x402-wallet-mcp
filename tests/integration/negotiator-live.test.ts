/**
 * Live integration test — makes real x402 payments.
 * Only runs when RUN_LIVE_TESTS=1 and X402_PRIVATE_KEY is set.
 * Cost: ~$0.002 per run (hackernews endpoint).
 */
import { describe, it, expect } from "vitest";
import { ByokWallet } from "../../src/wallet/byok-wallet.js";
import { makePaymentCall } from "../../src/payment/negotiator.js";

const SHOULD_RUN =
  process.env.RUN_LIVE_TESTS === "1" && !!process.env.X402_PRIVATE_KEY;

describe.skipIf(!SHOULD_RUN)("Live negotiator", () => {
  it("pays for hackernews/top endpoint ($0.002)", async () => {
    const wallet = new ByokWallet(
      process.env.X402_PRIVATE_KEY as `0x${string}`,
    );

    const result = await makePaymentCall(
      "https://x402.onchainexpat.com/api/x402-tools/hackernews/top",
      {
        wallet,
        checkSpendingLimit: () => ({ allowed: true }),
        recordTransaction: () => {},
        method: "POST",
        body: JSON.stringify({ limit: 3 }),
      },
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect(result.amountPaid).toBeGreaterThan(0n);
    expect(result.data).toBeDefined();
  }, 30_000);
});
