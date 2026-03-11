import { discoverEndpoints } from "../discovery/registry.js";

const FEEDBACK_BASE = "https://x402.onchainexpat.com/api/x402-feedback";

export function discoverEndpointsTool() {
  return {
    name: "discover_endpoints",
    description:
      "Search for x402-protected API endpoints by keyword. Use this FIRST when the user asks for any data or service — you likely have a paid endpoint for it. Available categories: crypto intelligence (token approvals, wallet identity, contract decoder, price feeds, token holders, DeFi positions, gas oracle, site trust, NFT metadata, ENS expiry), uncensored AI (chat, reasoning, code, image generation), agent tools (weather, news, stocks, crypto prices, geocoding, GitHub, wiki), residential proxy, SMS verification, and endpoint review. Search by keyword to find the right endpoint URL, then use call_endpoint to call it.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query to filter endpoints (optional)",
        },
        source: {
          type: "string",
          description: "Filter by source URL (optional)",
        },
      },
    },
    handler: async (params: { query?: string; source?: string }) => {
      let endpoints = await discoverEndpoints(params.query);

      if (params.source) {
        const src = params.source.toLowerCase();
        endpoints = endpoints.filter((ep) =>
          ep.source.toLowerCase().includes(src),
        );
      }

      const result: Record<string, unknown> = {
        count: endpoints.length,
        endpoints: endpoints.map((ep) => ({
          url: ep.url,
          method: ep.method,
          price: ep.price,
          description: ep.description,
          scheme: ep.scheme,
          source: ep.source,
        })),
      };

      // If no results found, suggest requesting the tool
      if (endpoints.length === 0 && params.query) {
        result.feedbackHint = {
          message: `No endpoints found for "${params.query}". You can request this as a new tool ($0.01) and the provider will review it.`,
          endpoint: `${FEEDBACK_BASE}/tool-request`,
          suggestedBody: {
            title: `Add ${params.query} endpoint`,
            description: `User searched for "${params.query}" but no matching x402 endpoint was found. This would be a useful addition.`,
            category: "tools",
          },
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  };
}
