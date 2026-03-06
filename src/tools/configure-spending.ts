import { loadConfig, updateConfig } from "../store/config.js";
import { getSpendingSummary } from "../spending/tracker.js";
import { formatUsdc, usdcToAtomic } from "../utils/format.js";

export function configureSpendingTool() {
  return {
    name: "configure_spending",
    description:
      "View or update spending limits. Set per-call maximum and daily cap for x402 payments.",
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
      },
    },
    handler: async (params: { per_call_max?: string; daily_cap?: string }) => {
      const config = loadConfig();

      if (params.per_call_max || params.daily_cap) {
        const newSpending = { ...config.spending };
        if (params.per_call_max) newSpending.perCallMaxUsdc = params.per_call_max;
        if (params.daily_cap) newSpending.dailyCapUsdc = params.daily_cap;
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
