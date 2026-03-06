import { probeEndpoint } from "../payment/negotiator.js";
import { formatUsdc } from "../utils/format.js";

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

      const summary = {
        x402Version: result.x402Version,
        paymentOptions: result.accepts.map((a) => ({
          scheme: a.scheme,
          network: a.network,
          price: formatUsdc(BigInt(a.maxAmountRequired ?? a.amount)),
          priceAtomic: a.maxAmountRequired ?? a.amount,
          payTo: a.payTo,
          asset: a.asset,
        })),
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
