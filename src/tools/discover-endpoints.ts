import { discoverEndpoints } from "../discovery/registry.js";

const FEEDBACK_BASE = "https://x402.onchainexpat.com/api/x402-feedback";

export function discoverEndpointsTool() {
  return {
    name: "discover_endpoints",
    description:
      "Search for x402-protected API endpoints. Fetches from .well-known/x402 discovery documents and x402scan.com.",
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
