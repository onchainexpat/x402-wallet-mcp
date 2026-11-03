import { probeEndpoint } from "../payment/negotiator.js";
import { formatUsdc } from "../utils/format.js";
import { resolveAcceptAmount } from "../payment/amount.js";

export function queryEndpointTool() {
  return {
    name: "query_endpoint",
    description:
      "Probe an x402 endpoint to see its pricing and payment requirements without paying. Returns the accept entries showing supported payment methods and prices.",
    inputSchema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "The full URL of the endpoint to probe",
        },
        method: {
          type: "string",
          description: "HTTP method to use (default: POST)",
          enum: ["GET", "POST"],
        },
      },
      required: ["url"],
    },
    handler: async (params: { url: string; method?: string }) => {
      const result = await probeEndpoint(params.url, params.method);

      if (!result) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "not_paid",
                  message: "This endpoint did not return a 402 response. It may be free or may not exist.",
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const accepts = result.accepts ?? [];
      if (accepts.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "no_payment_options",
                  message: "This endpoint returned 402 but listed no payment options, so it cannot be paid.",
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const summary = {
        x402Version: result.x402Version,
        // Same price reader call_endpoint pays with, so the preview never
        // shows a price that the payment would refuse or sign differently.
        paymentOptions: accepts.map((a) => {
          try {
            const atomic = resolveAcceptAmount(a);
            return {
              scheme: a.scheme,
              network: a.network,
              price: formatUsdc(atomic),
              priceAtomic: String(atomic),
              payTo: a.payTo,
              asset: a.asset,
            };
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            return {
              scheme: a.scheme,
              network: a.network,
              price: "invalid",
              priceAtomic: null,
              payTo: a.payTo,
              asset: a.asset,
              error: `${reason}. call_endpoint will not pay this option.`,
            };
          }
        }),
      };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    },
  };
}
