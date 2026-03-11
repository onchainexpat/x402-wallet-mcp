import type { WalletProvider } from "../wallet/types.js";
import { makePaymentCall, probeEndpoint, pickAcceptEntry } from "../payment/negotiator.js";
import {
  checkSpendingLimit,
  recordSpending,
  isUnderAutoApproveThreshold,
  recordAutoApproval,
  resetAutoApproveTracker,
  getAutoApproveSummary,
} from "../spending/tracker.js";
import { appendTransaction } from "../store/history.js";
import { formatUsdc } from "../utils/format.js";
import { loadConfig } from "../store/config.js";
import type { TransactionEntry } from "../payment/negotiator.js";

function buildPaymentCallOptions(wallet: WalletProvider, params: {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  prefer_escrow?: boolean;
}) {
  return {
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
  };
}

const FEEDBACK_BASE = "https://x402.onchainexpat.com/api/x402-feedback";

function formatResult(result: { success: boolean; status: number; data: unknown; amountPaid?: bigint; network?: string; scheme?: string; error?: string }, endpointUrl?: string) {
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

  // If the call failed after payment, suggest filing a bug report
  if (!result.success && result.amountPaid !== undefined && result.amountPaid > 0n) {
    summary.feedbackHint = {
      message: "This endpoint failed after payment was made. You can help improve it by submitting a bug report ($0.01).",
      endpoint: `${FEEDBACK_BASE}/bug-report`,
      suggestedBody: {
        title: `${result.status} error from ${endpointUrl ?? "unknown endpoint"}`,
        description: `Endpoint returned status ${result.status} after payment. Error: ${result.error ?? "unknown"}`,
        category: "api",
        severity: result.status >= 500 ? "high" : "medium",
        endpoint_affected: endpointUrl,
      },
    };
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
}

export function callEndpointTool(wallet: WalletProvider) {
  return {
    name: "call_endpoint",
    description:
      "Make a paid API call to an x402-protected endpoint. Handles 402 payment negotiation automatically. Payments under the auto-approve threshold (default $0.05) execute silently. Payments over the threshold return a preview — call again with confirmed: true after user approves. Use discover_endpoints first to find the right URL if you don't know it.",
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
        confirmed: {
          type: "boolean",
          description: "Set to true after user confirms a payment that exceeded the auto-approve threshold",
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
      confirmed?: boolean;
    }) => {
      // If user explicitly confirmed, reset tracker and execute directly
      if (params.confirmed) {
        resetAutoApproveTracker();
        const result = await makePaymentCall(params.url, buildPaymentCallOptions(wallet, params));
        return formatResult(result, params.url);
      }

      // Probe the endpoint to check price before paying
      const config = loadConfig();
      const preferEscrow = params.prefer_escrow ?? config.preferences.preferEscrow;
      let probeResult;
      try {
        probeResult = await probeEndpoint(params.url, params.method);
      } catch {
        probeResult = null;
      }

      // No 402 response — not a paid endpoint, call directly
      if (!probeResult) {
        const result = await makePaymentCall(params.url, buildPaymentCallOptions(wallet, params));
        return formatResult(result, params.url);
      }

      // Normalize v2 paymentOptions to v1 accepts format (same as negotiator)
      const raw = probeResult as unknown as Record<string, unknown>;
      if (!probeResult.accepts && Array.isArray(raw.paymentOptions)) {
        probeResult.accepts = (raw.paymentOptions as Record<string, unknown>[]).map(
          (opt) => ({
            scheme: ((opt.scheme as string) ?? "exact") as "exact" | "escrow",
            network: opt.network as string,
            amount: (opt.priceAtomic as string) ?? (opt.amount as string) ?? "0",
            maxAmountRequired: opt.maxAmountRequired as string | undefined,
            payTo: opt.payTo as string,
            asset: opt.asset as string,
            maxTimeoutSeconds: opt.maxTimeoutSeconds as number | undefined,
            extra: opt.extra as Record<string, unknown> | undefined,
          }),
        );
      }

      const accepts = probeResult.accepts;
      if (!accepts || accepts.length === 0) {
        // Can't determine price — require confirmation to be safe
        const autoApprove = getAutoApproveSummary();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                requiresConfirmation: true,
                endpoint: params.url,
                price: "unknown",
                sessionAutoApproved: autoApprove.sessionAutoApproved,
                threshold: autoApprove.threshold,
                message: "Could not determine the price for this endpoint. Ask the user to confirm, then call this tool again with confirmed: true.",
              }, null, 2),
            },
          ],
          isError: false,
        };
      }

      const accept = pickAcceptEntry(accepts, preferEscrow);
      if (!accept) {
        const result = await makePaymentCall(params.url, buildPaymentCallOptions(wallet, params));
        return formatResult(result, params.url);
      }

      const amountAtomic = BigInt(accept.maxAmountRequired ?? accept.amount);

      // Check if under auto-approve threshold
      if (isUnderAutoApproveThreshold(amountAtomic)) {
        recordAutoApproval(amountAtomic);
        const result = await makePaymentCall(params.url, buildPaymentCallOptions(wallet, params));
        return formatResult(result, params.url);
      }

      // Over threshold — return preview for user confirmation
      const autoApprove = getAutoApproveSummary();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              requiresConfirmation: true,
              endpoint: params.url,
              price: formatUsdc(amountAtomic),
              sessionAutoApproved: autoApprove.sessionAutoApproved,
              threshold: autoApprove.threshold,
              message: `This call costs ${formatUsdc(amountAtomic)} which exceeds the auto-approve threshold of ${autoApprove.threshold}. Ask the user to confirm, then call this tool again with confirmed: true.`,
            }, null, 2),
          },
        ],
        isError: false,
      };
    },
  };
}
