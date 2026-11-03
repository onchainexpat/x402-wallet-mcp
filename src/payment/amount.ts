/**
 * The one place a payment option's price is read.
 *
 * A 402 can carry the price in `maxAmountRequired` (x402 v1) or `amount` (v2),
 * and the server controls both. Every spending control and both signers must
 * agree on one number, so they all call this. An exact payment option whose two
 * fields disagree is refused outright rather than guessed at.
 */

import type { AcceptEntry } from "./types.js";

export class PaymentAmountError extends Error {}

function parseAtomic(field: string, value: unknown): bigint {
  // Plain decimal digits only: BigInt() would also take "0x...", "-5" and " 5 ".
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new PaymentAmountError(`Payment option has an invalid ${field}: ${JSON.stringify(value)}`);
  }
  return BigInt(value);
}

export function resolveAcceptAmount(accept: AcceptEntry): bigint {
  const max = accept.maxAmountRequired;
  const amount = accept.amount;
  const hasMax = max !== undefined && max !== null;
  const hasAmount = amount !== undefined && amount !== null;

  if (!hasMax && !hasAmount) {
    throw new PaymentAmountError("Payment option has no amount");
  }
  // Escrow authorizes a ceiling (maxAmountRequired) and the capture may be
  // lower, so the two can legitimately differ. The escrow signer commits the
  // ceiling everywhere it writes a value, and every gate sees that same ceiling.
  if (accept.scheme === "escrow") {
    return hasMax ? parseAtomic("maxAmountRequired", max) : parseAtomic("amount", amount);
  }
  // Exact transfers move precisely the signed value: one price or nothing.
  if (hasMax && hasAmount) {
    const a = parseAtomic("maxAmountRequired", max);
    const b = parseAtomic("amount", amount);
    if (a !== b) {
      throw new PaymentAmountError(
        `Payment option quotes two different prices (maxAmountRequired ${a}, amount ${b}); refusing to pay`,
      );
    }
    return a;
  }
  return hasMax ? parseAtomic("maxAmountRequired", max) : parseAtomic("amount", amount);
}
