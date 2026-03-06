import { loadConfig } from "../store/config.js";
import { loadSpending, addSpending } from "./store.js";
import { usdcToAtomic, formatUsdc } from "../utils/format.js";

export interface SpendingCheck {
  allowed: boolean;
  reason?: string;
}

/** Check if a payment amount is within spending limits */
export function checkSpendingLimit(amountAtomic: bigint): SpendingCheck {
  const config = loadConfig();

  // Per-call max
  const perCallMax = usdcToAtomic(
    process.env.X402_PER_CALL_MAX ?? config.spending.perCallMaxUsdc,
  );
  if (amountAtomic > perCallMax) {
    return {
      allowed: false,
      reason: `Amount ${formatUsdc(amountAtomic)} exceeds per-call max of ${formatUsdc(perCallMax)}`,
    };
  }

  // Daily cap
  const dailyCap = usdcToAtomic(
    process.env.X402_DAILY_CAP ?? config.spending.dailyCapUsdc,
  );
  const spending = loadSpending();
  const currentTotal = BigInt(spending.totalAtomic);
  if (currentTotal + amountAtomic > dailyCap) {
    return {
      allowed: false,
      reason: `Would exceed daily cap of ${formatUsdc(dailyCap)} (spent today: ${formatUsdc(currentTotal)})`,
    };
  }

  return { allowed: true };
}

/** Record a successful payment in the daily tracker */
export function recordSpending(amountAtomic: bigint): void {
  addSpending(amountAtomic);
}

/** Get current spending summary */
export function getSpendingSummary(): {
  todaySpent: string;
  todayCount: number;
  dailyCap: string;
  perCallMax: string;
} {
  const config = loadConfig();
  const spending = loadSpending();
  return {
    todaySpent: spending.totalAtomic,
    todayCount: spending.callCount,
    dailyCap: config.spending.dailyCapUsdc,
    perCallMax: config.spending.perCallMaxUsdc,
  };
}
