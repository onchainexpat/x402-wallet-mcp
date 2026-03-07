import type { WalletProvider } from "../wallet/types.js";
import { makePaymentCall } from "../payment/negotiator.js";
import { checkSpendingLimit, recordSpending } from "../spending/tracker.js";
import { appendTransaction } from "../store/history.js";
import { formatUsdc } from "../utils/format.js";
import type { TransactionEntry } from "../payment/negotiator.js";

export function callEndpointTool(wallet: WalletProvider) {
  return {
    name: "call_endpoint",
    description:
      "Make a paid API call to an x402-protected endpoint. Handles 402 payment negotiation automatically. This is the main tool for calling paid APIs.",
    inputSchema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "The full URL of the x402 endpoint to call",
        },
        method: {
          type: "string",
          description: "HTTP method (default: POST)",
          enum: ["GET", "POST", "PUT", "DELETE"],
        },
        body: {
          type: "string",
          description: "JSON request body (for POST/PUT)",
        },
        headers: {
          type: "object",
          description: "Additional HTTP headers",
          additionalProperties: { type: "string" },
        },
        prefer_escrow: {
          type: "boolean",
          description: "Prefer escrow payment if available (default: false)",
        },
      },
      required: ["url"],
    },
    handler: async (params: {
      url: string;
      method?: string;
      body?: string;
      headers?: Record<string, string>;
      prefer_escrow?: boolean;
    }) => {
      const result = await makePaymentCall(params.url, {
        wallet,
        checkSpendingLimit,
        recordTransaction: (entry: TransactionEntry) => {
          appendTransaction(entry);
          if (entry.status === "success") {
            recordSpending(BigInt(entry.amount));
          }
        },
        method: params.method,
        body: params.body,
        headers: params.headers,
        preferEscrow: params.prefer_escrow,
      });

      const summary: Record<string, unknown> = {
        success: result.success,
        status: result.status,
        data: result.data,
      };

      if (result.amountPaid !== undefined && result.amountPaid > 0n) {
        summary.amountPaid = formatUsdc(result.amountPaid);
        summary.network = result.network;
        summary.scheme = result.scheme;
      }

      if (result.error) {
        summary.error = result.error;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(summary, (_k, v) =>
              typeof v === "bigint" ? v.toString() : v,
              2,
            ),
          },
        ],
        isError: !result.success,
      };
    },
  };
}
