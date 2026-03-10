import { loadConfig } from "../store/config.js";
import { loadSpending, addSpending } from "./store.js";
import { usdcToAtomic, formatUsdc, atomicToUsdc } from "../utils/format.js";

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
  autoApproveThreshold: string;
  sessionAutoApproved: string;
} {
  const config = loadConfig();
  const spending = loadSpending();
  return {
    todaySpent: spending.totalAtomic,
    todayCount: spending.callCount,
    dailyCap: config.spending.dailyCapUsdc,
    perCallMax: config.spending.perCallMaxUsdc,
    autoApproveThreshold: config.spending.autoApproveThresholdUsdc,
    sessionAutoApproved: atomicToUsdc(BigInt(sessionAutoApprovedAtomic)),
  };
}

// --- Session-scoped auto-approve tracking (in-memory, resets on restart) ---

let sessionAutoApprovedAtomic = 0n;

/** Check if a payment amount is under the auto-approve threshold (including cumulative session total) */
export function isUnderAutoApproveThreshold(amountAtomic: bigint): boolean {
  const config = loadConfig();
  const threshold = usdcToAtomic(config.spending.autoApproveThresholdUsdc);
  return sessionAutoApprovedAtomic + amountAtomic <= threshold;
}

/** Record an auto-approved payment in the session tracker */
export function recordAutoApproval(amountAtomic: bigint): void {
  sessionAutoApprovedAtomic += amountAtomic;
}

/** Reset the session auto-approve tracker (called after explicit user confirmation) */
export function resetAutoApproveTracker(): void {
  sessionAutoApprovedAtomic = 0n;
}

/** Get auto-approve summary for display */
export function getAutoApproveSummary(): { sessionAutoApproved: string; threshold: string } {
  const config = loadConfig();
  return {
    sessionAutoApproved: formatUsdc(sessionAutoApprovedAtomic),
    threshold: formatUsdc(usdcToAtomic(config.spending.autoApproveThresholdUsdc)),
  };
}
