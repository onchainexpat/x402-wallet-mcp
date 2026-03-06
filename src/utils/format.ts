/**
 * USDC formatting utilities.
 * USDC has 6 decimals on both EVM and Solana.
 */

const USDC_DECIMALS = 6;
const USDC_FACTOR = BigInt(10 ** USDC_DECIMALS);

/** Convert human-readable USDC string (e.g. "1.50") to atomic units (1500000n) */
export function usdcToAtomic(human: string): bigint {
  const parts = human.split(".");
  const whole = BigInt(parts[0] || "0") * USDC_FACTOR;
  if (parts.length === 1) return whole;
  const decStr = (parts[1] || "0").padEnd(USDC_DECIMALS, "0").slice(0, USDC_DECIMALS);
  return whole + BigInt(decStr);
}

/** Convert atomic USDC units (1500000n) to human-readable string ("1.500000") */
export function atomicToUsdc(atomic: bigint): string {
  const isNeg = atomic < 0n;
  const abs = isNeg ? -atomic : atomic;
  const whole = abs / USDC_FACTOR;
  const frac = abs % USDC_FACTOR;
  const fracStr = frac.toString().padStart(USDC_DECIMALS, "0");
  const sign = isNeg ? "-" : "";
  return `${sign}${whole}.${fracStr}`;
}

/** Format atomic USDC for display (e.g. "$1.50") */
export function formatUsdc(atomic: bigint): string {
  const raw = atomicToUsdc(atomic);
  // Trim trailing zeros but keep at least 2 decimals
  const [whole, frac] = raw.split(".");
  const trimmed = (frac || "000000").replace(/0+$/, "").padEnd(2, "0");
  return `$${whole}.${trimmed}`;
}

/** Parse a string that might be atomic units or human-readable USDC */
export function parseUsdcAmount(value: string): bigint {
  // If it looks like an integer with 6+ digits, treat as atomic
  if (/^\d+$/.test(value) && value.length >= 6) {
    return BigInt(value);
  }
  // Otherwise treat as human-readable
  return usdcToAtomic(value);
}
