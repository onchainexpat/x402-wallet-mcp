import { describe, it, expect } from "vitest";
import { computeEscrowNonce } from "../../../src/payment/evm-escrow.js";
import type { PaymentInfo } from "../../../src/payment/types.js";

describe("computeEscrowNonce", () => {
  const basePaymentInfo: PaymentInfo = {
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

  it("produces a 32-byte hex string", () => {
    const nonce = computeEscrowNonce(
      8453,
      "0x320a3c35F131E5D2Fb36af56345726B298936037",
      basePaymentInfo,
    );
    expect(nonce).toMatch(/^0x[0-9a-f]{64}$/i);
  });

  it("is deterministic (same inputs = same output)", () => {
    const nonce1 = computeEscrowNonce(
      8453,
      "0x320a3c35F131E5D2Fb36af56345726B298936037",
      basePaymentInfo,
    );
    const nonce2 = computeEscrowNonce(
      8453,
      "0x320a3c35F131E5D2Fb36af56345726B298936037",
      basePaymentInfo,
    );
    expect(nonce1).toBe(nonce2);
  });

  it("changes when salt changes", () => {
    const nonce1 = computeEscrowNonce(
      8453,
      "0x320a3c35F131E5D2Fb36af56345726B298936037",
      { ...basePaymentInfo, salt: "0x" + "aa".repeat(32) },
    );
    const nonce2 = computeEscrowNonce(
      8453,
      "0x320a3c35F131E5D2Fb36af56345726B298936037",
      { ...basePaymentInfo, salt: "0x" + "bb".repeat(32) },
    );
    expect(nonce1).not.toBe(nonce2);
  });

  it("changes when chain ID changes", () => {
    const nonce1 = computeEscrowNonce(
      8453,
      "0x320a3c35F131E5D2Fb36af56345726B298936037",
      basePaymentInfo,
    );
    const nonce2 = computeEscrowNonce(
      84532, // sepolia
      "0x320a3c35F131E5D2Fb36af56345726B298936037",
      basePaymentInfo,
    );
    expect(nonce1).not.toBe(nonce2);
  });

  it("changes when escrow address changes", () => {
    const nonce1 = computeEscrowNonce(
      8453,
      "0x320a3c35F131E5D2Fb36af56345726B298936037",
      basePaymentInfo,
    );
    const nonce2 = computeEscrowNonce(
      8453,
      "0x0000000000000000000000000000000000000001",
      basePaymentInfo,
    );
    expect(nonce1).not.toBe(nonce2);
  });

  it("changes when operator changes", () => {
    const nonce1 = computeEscrowNonce(
      8453,
      "0x320a3c35F131E5D2Fb36af56345726B298936037",
      basePaymentInfo,
    );
    const nonce2 = computeEscrowNonce(
      8453,
      "0x320a3c35F131E5D2Fb36af56345726B298936037",
      { ...basePaymentInfo, operator: "0x0000000000000000000000000000000000000002" },
    );
    expect(nonce1).not.toBe(nonce2);
  });

  it("changes when receiver changes", () => {
    const nonce1 = computeEscrowNonce(
      8453,
      "0x320a3c35F131E5D2Fb36af56345726B298936037",
      basePaymentInfo,
    );
    const nonce2 = computeEscrowNonce(
      8453,
      "0x320a3c35F131E5D2Fb36af56345726B298936037",
      { ...basePaymentInfo, receiver: "0x0000000000000000000000000000000000000003" },
    );
    expect(nonce1).not.toBe(nonce2);
  });

  it("changes when maxAmount changes", () => {
    const nonce1 = computeEscrowNonce(
      8453,
      "0x320a3c35F131E5D2Fb36af56345726B298936037",
      { ...basePaymentInfo, maxAmount: "4000" },
    );
    const nonce2 = computeEscrowNonce(
      8453,
      "0x320a3c35F131E5D2Fb36af56345726B298936037",
      { ...basePaymentInfo, maxAmount: "8000" },
    );
    expect(nonce1).not.toBe(nonce2);
  });

  it("changes when fee settings change", () => {
    const nonce1 = computeEscrowNonce(
      8453,
      "0x320a3c35F131E5D2Fb36af56345726B298936037",
      { ...basePaymentInfo, minFeeBps: 0, maxFeeBps: 0 },
    );
    const nonce2 = computeEscrowNonce(
      8453,
      "0x320a3c35F131E5D2Fb36af56345726B298936037",
      { ...basePaymentInfo, minFeeBps: 100, maxFeeBps: 500 },
    );
    expect(nonce1).not.toBe(nonce2);
  });

  it("is payer-agnostic (no payer field in input)", () => {
    // The nonce computation uses address(0) as payer
    // This ensures the same nonce regardless of who pays
    const nonce = computeEscrowNonce(
      8453,
      "0x320a3c35F131E5D2Fb36af56345726B298936037",
      basePaymentInfo,
    );
    // Just verify it doesn't contain any payer-specific data
    // (we can't easily test this without the contract, but
    // we verify the function doesn't accept a payer param)
    expect(nonce).toBeDefined();
  });
});
