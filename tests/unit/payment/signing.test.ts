import { describe, it, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { signExactPayment } from "../../../src/payment/evm-exact.js";
import { computeEscrowNonce, signEscrowPayment } from "../../../src/payment/evm-escrow.js";
import type { WalletProvider } from "../../../src/wallet/types.js";
import type { AcceptEntry } from "../../../src/payment/types.js";

// Use Hardhat account #0 for deterministic tests
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`;
const TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

/** Minimal signing wallet for tests — signs with a local private key via viem */
function createTestWallet(): WalletProvider {
  const account = privateKeyToAccount(TEST_KEY);
  return {
    mode: "privy",
    getEvmAddress: () => account.address,
    async signTypedData(domain, types, primaryType, message) {
      return account.signTypedData({
        domain: domain as any,
        types: types as any,
        primaryType,
        message,
      });
    },
    describe: () => ({
      mode: "privy",
      evmAddress: account.address,
      recoverable: true,
    }),
  };
}

describe("EVM Exact payment signing", () => {
  it("produces a valid base64-encoded payment header", async () => {
    const wallet = createTestWallet();

    const accept: AcceptEntry = {
      scheme: "exact",
      network: "base",
      amount: "2000", // 0.002 USDC
      payTo: "0xd8bA61a0b0974db0EC8E325C7628470526558E9B",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      maxTimeoutSeconds: 60,
      extra: {
        name: "USD Coin",
        version: "2",
      },
    };

    const encoded = await signExactPayment(wallet, accept);

    // Decode and verify structure
    const decoded = JSON.parse(atob(encoded));
    expect(decoded.x402Version).toBe(1);
    expect(decoded.scheme).toBe("exact");
    expect(decoded.network).toBe("base");
    expect(decoded.payload.signature).toMatch(/^0x[0-9a-f]{130}$/i);
    expect(decoded.payload.authorization.from.toLowerCase()).toBe(
      TEST_ADDRESS.toLowerCase(),
    );
    expect(decoded.payload.authorization.to).toBe(accept.payTo);
    expect(decoded.payload.authorization.value).toBe("2000");
    expect(decoded.payload.authorization.nonce).toMatch(/^0x[0-9a-f]{64}$/i);
  });

  it("maps CAIP-2 network correctly", async () => {
    const wallet = createTestWallet();

    const accept: AcceptEntry = {
      scheme: "exact",
      network: "eip155:8453",
      amount: "1000",
      payTo: "0xd8bA61a0b0974db0EC8E325C7628470526558E9B",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      extra: { name: "USD Coin", version: "2" },
    };

    const encoded = await signExactPayment(wallet, accept);
    const decoded = JSON.parse(atob(encoded));
    expect(decoded.network).toBe("base");
  });
});

describe("Escrow nonce computation", () => {
  it("produces a deterministic 32-byte hash", () => {
    const paymentInfo = {
      operator: "0xB5337C63D5bC8561CbE1F36aC4f6A366F72BCAF7",
      receiver: "0xd8bA61a0b0974db0EC8E325C7628470526558E9B",
      token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      maxAmount: "4000",
      preApprovalExpiry: 281474976710655,
      authorizationExpiry: 281474976710655,
      refundExpiry: 281474976710655,
      minFeeBps: 0,
      maxFeeBps: 0,
      feeReceiver: "0xB5337C63D5bC8561CbE1F36aC4f6A366F72BCAF7",
      salt: "0x" + "ab".repeat(32),
    };

    const nonce = computeEscrowNonce(
      8453,
      "0x320a3c35F131E5D2Fb36af56345726B298936037",
      paymentInfo,
    );

    expect(nonce).toMatch(/^0x[0-9a-f]{64}$/i);

    // Same inputs should produce same nonce
    const nonce2 = computeEscrowNonce(
      8453,
      "0x320a3c35F131E5D2Fb36af56345726B298936037",
      paymentInfo,
    );
    expect(nonce2).toBe(nonce);
  });

  it("produces different nonces for different salts", () => {
    const base = {
      operator: "0xB5337C63D5bC8561CbE1F36aC4f6A366F72BCAF7",
      receiver: "0xd8bA61a0b0974db0EC8E325C7628470526558E9B",
      token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      maxAmount: "4000",
      preApprovalExpiry: 281474976710655,
      authorizationExpiry: 281474976710655,
      refundExpiry: 281474976710655,
      minFeeBps: 0,
      maxFeeBps: 0,
      feeReceiver: "0xB5337C63D5bC8561CbE1F36aC4f6A366F72BCAF7",
    };

    const nonce1 = computeEscrowNonce(8453, "0x320a3c35F131E5D2Fb36af56345726B298936037", {
      ...base,
      salt: "0x" + "aa".repeat(32),
    });
    const nonce2 = computeEscrowNonce(8453, "0x320a3c35F131E5D2Fb36af56345726B298936037", {
      ...base,
      salt: "0x" + "bb".repeat(32),
    });

    expect(nonce1).not.toBe(nonce2);
  });
});

describe("EVM Escrow payment signing", () => {
  it("produces a valid base64-encoded escrow payment header", async () => {
    const wallet = createTestWallet();

    const accept: AcceptEntry = {
      scheme: "escrow",
      network: "eip155:8453",
      amount: "4000",
      maxAmountRequired: "4000",
      payTo: "0xd8bA61a0b0974db0EC8E325C7628470526558E9B",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      maxTimeoutSeconds: 600,
      extra: {
        name: "USD Coin",
        version: "2",
        operatorAddress: "0xB5337C63D5bC8561CbE1F36aC4f6A366F72BCAF7",
        escrowAddress: "0x320a3c35F131E5D2Fb36af56345726B298936037",
        tokenCollector: "0x32d6AC59BCe8DFB3026F10BcaDB8D00AB218f5b6",
        minFeeBps: 0,
        maxFeeBps: 0,
      },
    };

    const encoded = await signEscrowPayment(wallet, accept);
    const decoded = JSON.parse(atob(encoded));

    expect(decoded.x402Version).toBe(2);
    expect(decoded.scheme).toBe("escrow");
    expect(decoded.network).toBe("eip155:8453");
    expect(decoded.payload.signature).toMatch(/^0x[0-9a-f]{130}$/i);
    expect(decoded.payload.authorization.from.toLowerCase()).toBe(
      TEST_ADDRESS.toLowerCase(),
    );
    // Escrow: to = tokenCollector, NOT payTo
    expect(decoded.payload.authorization.to).toBe(
      "0x32d6AC59BCe8DFB3026F10BcaDB8D00AB218f5b6",
    );
    expect(decoded.payload.authorization.validAfter).toBe("0");
    expect(decoded.payload.authorization.validBefore).toBe("281474976710655");
    expect(decoded.payload.paymentInfo).toBeDefined();
    expect(decoded.payload.paymentInfo.operator).toBe(
      "0xB5337C63D5bC8561CbE1F36aC4f6A366F72BCAF7",
    );
    expect(decoded.accepted).toBeDefined();
    expect(decoded.resource.method).toBe("POST");
  });
});
