import { describe, it, expect } from "vitest";
import { resolveAcceptAmount, PaymentAmountError } from "../../../src/payment/amount.js";
import type { AcceptEntry } from "../../../src/payment/types.js";

const base = {
  network: "eip155:8453",
  payTo: "0xd8bA61a0b0974db0EC8E325C7628470526558E9B",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

function exact(fields: Partial<AcceptEntry>): AcceptEntry {
  return { scheme: "exact", ...base, ...fields } as AcceptEntry;
}

describe("resolveAcceptAmount", () => {
  it("reads amount alone (v2)", () => {
    expect(resolveAcceptAmount(exact({ amount: "2000" }))).toBe(2000n);
  });

  it("reads maxAmountRequired alone (v1)", () => {
    expect(resolveAcceptAmount(exact({ amount: undefined as unknown as string, maxAmountRequired: "3000" }))).toBe(3000n);
  });

  it("accepts both when they agree", () => {
    expect(resolveAcceptAmount(exact({ amount: "4000", maxAmountRequired: "4000" }))).toBe(4000n);
  });

  it("refuses an exact option whose two prices disagree", () => {
    expect(() => resolveAcceptAmount(exact({ amount: "5000000000", maxAmountRequired: "1000" }))).toThrow(PaymentAmountError);
    expect(() => resolveAcceptAmount(exact({ amount: "1000", maxAmountRequired: "5000000000" }))).toThrow(PaymentAmountError);
  });

  it("uses the ceiling for escrow, where the two may differ", () => {
    const accept = { scheme: "escrow", ...base, amount: "2000", maxAmountRequired: "4000" } as AcceptEntry;
    expect(resolveAcceptAmount(accept)).toBe(4000n);
  });

  it.each(["", "-5", "0x10", " 5", "1e6", "1.5"])("refuses a malformed amount %j", (bad) => {
    expect(() => resolveAcceptAmount(exact({ amount: bad }))).toThrow(PaymentAmountError);
  });

  it("refuses an option with no amount at all", () => {
    expect(() => resolveAcceptAmount(exact({ amount: undefined as unknown as string }))).toThrow(PaymentAmountError);
  });
});
