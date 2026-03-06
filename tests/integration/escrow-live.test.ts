/**
 * Live escrow integration test.
 * Only runs when RUN_LIVE_TESTS=1 and X402_PRIVATE_KEY is set.
 * Cost: ~$0.02 per run (escrow hackernews endpoint).
 */
import { describe, it, expect } from "vitest";
import { ByokWallet } from "../../src/wallet/byok-wallet.js";
import { makePaymentCall } from "../../src/payment/negotiator.js";

const SHOULD_RUN =
  process.env.RUN_LIVE_TESTS === "1" && !!process.env.X402_PRIVATE_KEY;

describe.skipIf(!SHOULD_RUN)("Live escrow payment", () => {
  it("pays for escrow hackernews/top endpoint ($0.02)", async () => {
    const wallet = new ByokWallet(
      process.env.X402_PRIVATE_KEY as `0x${string}`,
    );

    const result = await makePaymentCall(
      "https://x402.onchainexpat.com/api/x402r-tools/hackernews/top",
      {
        wallet,
        checkSpendingLimit: () => ({ allowed: true }),
        recordTransaction: () => {},
        method: "POST",
        body: JSON.stringify({ limit: 3 }),
        preferEscrow: true,
      },
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect(result.scheme).toBe("escrow");
  }, 30_000);
});
