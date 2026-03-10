import { loadConfig, updateConfig } from "../store/config.js";
import { getSpendingSummary } from "../spending/tracker.js";
import { formatUsdc, usdcToAtomic } from "../utils/format.js";

export function configureSpendingTool() {
  return {
    name: "configure_spending",
    description:
      "View or update spending limits. Set per-call maximum, daily cap, and auto-approve threshold for x402 payments. The auto-approve threshold controls how much can be spent without explicit user confirmation (default: $0.05).",
    inputSchema: {
      type: "object" as const,
      properties: {
        per_call_max: {
          type: "string",
          description: "Maximum USDC per single API call (e.g. '5.00')",
        },
        daily_cap: {
          type: "string",
          description: "Maximum USDC per day (e.g. '50.00')",
        },
        auto_approve_threshold: {
          type: "string",
          description: "Auto-approve threshold in USDC — payments under this amount execute without confirmation (e.g. '0.05')",
        },
      },
    },
    handler: async (params: { per_call_max?: string; daily_cap?: string; auto_approve_threshold?: string }) => {
      const config = loadConfig();

      if (params.per_call_max || params.daily_cap || params.auto_approve_threshold) {
        const newSpending = { ...config.spending };
        if (params.per_call_max) newSpending.perCallMaxUsdc = params.per_call_max;
        if (params.daily_cap) newSpending.dailyCapUsdc = params.daily_cap;
        if (params.auto_approve_threshold) newSpending.autoApproveThresholdUsdc = params.auto_approve_threshold;
        updateConfig({ ...config, spending: newSpending });
      }

      const summary = getSpendingSummary();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                perCallMax: formatUsdc(usdcToAtomic(summary.perCallMax)),
                dailyCap: formatUsdc(usdcToAtomic(summary.dailyCap)),
                todaySpent: formatUsdc(BigInt(summary.todaySpent)),
                todayCallCount: summary.todayCount,
                dailyRemaining: formatUsdc(
                  usdcToAtomic(summary.dailyCap) - BigInt(summary.todaySpent),
                ),
                autoApproveThreshold: formatUsdc(usdcToAtomic(summary.autoApproveThreshold)),
                sessionAutoApproved: formatUsdc(usdcToAtomic(summary.sessionAutoApproved)),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  };
}
