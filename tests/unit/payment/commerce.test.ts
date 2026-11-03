import { describe, it, expect, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  BASE_COMMERCE_DEPLOYMENTS,
  CommerceTermsError,
  isCommerceScheme,
  resolveCommerceContracts,
} from "../../../src/payment/commerce.js";
import { computeEscrowNonce, signEscrowPayment } from "../../../src/payment/evm-escrow.js";
import { pickAcceptEntry } from "../../../src/payment/negotiator.js";
import { resolveAcceptAmount } from "../../../src/payment/amount.js";
import type { AcceptEntry } from "../../../src/payment/types.js";
import type { WalletProvider } from "../../../src/wallet/types.js";

const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`;
const ATTACKER = "0x000000000000000000000000000000000000dEaD";
const [CURRENT, EARLIER] = BASE_COMMERCE_DEPLOYMENTS;

function wallet(): WalletProvider & { signTypedData: ReturnType<typeof vi.fn> } {
  const account = privateKeyToAccount(TEST_KEY);
  return {
    mode: "privy",
    getEvmAddress: () => account.address,
    signTypedData: vi.fn((domain, types, primaryType, message) =>
      account.signTypedData({ domain: domain as any, types: types as any, primaryType, message }),
    ),
    describe: () => ({ mode: "privy", evmAddress: account.address, recoverable: true }),
  } as any;
}

/** The terms padelmaps.org's x402r endpoints sent on 2026-11-03, labelled "commerce". */
function padelmapsTerms(overrides: Partial<AcceptEntry> = {}, extra: Record<string, unknown> = {}): AcceptEntry {
  return {
    scheme: "commerce",
    network: "eip155:8453",
    amount: "10000",
    payTo: "0xd8bA61a0b0974db0EC8E325C7628470526558E9B",
    maxTimeoutSeconds: 60,
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    extra: {
      name: "USD Coin",
      version: "2",
      operatorAddress: "0x1A602eEC594BD9A50D8FD06BCC13D35c18FE68A8",
      escrowAddress: "0xb9488351E48b23D798f24e8174514F28B741Eb4f",
      tokenCollector: "0x48ADf6E37F9b31dC2AAD0462C5862B5422C736B8",
      minFeeBps: 0,
      maxFeeBps: 1000,
      ...extra,
    },
    ...overrides,
  } as AcceptEntry;
}

describe("commerce scheme name", () => {
  it("treats commerce and the legacy escrow name as the same scheme", () => {
    expect(isCommerceScheme("commerce")).toBe(true);
    expect(isCommerceScheme("escrow")).toBe(true);
    expect(isCommerceScheme("exact")).toBe(false);
  });

  it("picks a commerce option, alone or when escrow is preferred", () => {
    const exact = { ...padelmapsTerms(), scheme: "exact" } as AcceptEntry;
    const commerce = padelmapsTerms();
    expect(pickAcceptEntry([commerce], false)).toBe(commerce);
    expect(pickAcceptEntry([exact, commerce], true)).toBe(commerce);
    expect(pickAcceptEntry([exact, commerce], false)).toBe(exact);
  });

  it("reads a commerce price like escrow: the ceiling", () => {
    expect(resolveAcceptAmount(padelmapsTerms({ amount: "2000", maxAmountRequired: "4000" }))).toBe(4000n);
  });

  it("answers a commerce offer with scheme commerce, a legacy offer with escrow", async () => {
    const commerce = JSON.parse(atob(await signEscrowPayment(wallet(), padelmapsTerms())));
    expect(commerce.scheme).toBe("commerce");
    expect(commerce.accepted.scheme).toBe("commerce");
    const legacy = JSON.parse(atob(await signEscrowPayment(wallet(), padelmapsTerms({ scheme: "escrow" }))));
    expect(legacy.scheme).toBe("escrow");
    expect(legacy.accepted.scheme).toBe("escrow");
  });

  it("signs padelmaps.org's terms for its collector, with the nonce of its escrow", async () => {
    const decoded = JSON.parse(atob(await signEscrowPayment(wallet(), padelmapsTerms())));
    expect(decoded.payload.authorization.to).toBe(CURRENT.tokenCollector);
    expect(decoded.payload.authorization.value).toBe("10000");
    expect(decoded.payload.authorization.nonce).toBe(
      computeEscrowNonce(8453, CURRENT.escrow, decoded.payload.paymentInfo),
    );
  });
});

describe("commerce contracts are pinned", () => {
  it("accepts both published x402r deployments on Base, any letter case", () => {
    expect(resolveCommerceContracts(padelmapsTerms()).escrowAddress).toBe(CURRENT.escrow);
    const earlier = padelmapsTerms({}, { tokenCollector: EARLIER.tokenCollector.toLowerCase(), escrowAddress: EARLIER.escrow });
    expect(resolveCommerceContracts(earlier).tokenCollector).toBe(EARLIER.tokenCollector);
  });

  it("fills in the escrow that belongs to the collector when the server leaves it out", () => {
    expect(resolveCommerceContracts(padelmapsTerms({}, { escrowAddress: undefined })).escrowAddress).toBe(CURRENT.escrow);
  });

  it("refuses, before signing, a collector the server picked itself", async () => {
    const w = wallet();
    const terms = padelmapsTerms({}, { tokenCollector: ATTACKER });
    expect(() => resolveCommerceContracts(terms)).toThrow(CommerceTermsError);
    await expect(signEscrowPayment(w, terms)).rejects.toThrow(/Unknown token collector/);
    expect(w.signTypedData).not.toHaveBeenCalled();
  });

  it("refuses a missing collector", () => {
    expect(() => resolveCommerceContracts(padelmapsTerms({}, { tokenCollector: undefined }))).toThrow(/Unknown token collector/);
  });

  it("refuses an escrow that is not the collector's own", () => {
    expect(() => resolveCommerceContracts(padelmapsTerms({}, { escrowAddress: EARLIER.escrow }))).toThrow(/does not belong/);
  });

  it("refuses networks other than Base", () => {
    expect(() => resolveCommerceContracts(padelmapsTerms({ network: "eip155:1" }))).toThrow(/only supported on Base/);
  });

  it("refuses a missing or malformed operator", () => {
    expect(() => resolveCommerceContracts(padelmapsTerms({}, { operatorAddress: undefined }))).toThrow(/operatorAddress/);
    expect(() => resolveCommerceContracts(padelmapsTerms({}, { operatorAddress: "0x123" }))).toThrow(/operatorAddress/);
  });
});
