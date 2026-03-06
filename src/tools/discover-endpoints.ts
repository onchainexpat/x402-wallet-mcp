import { discoverEndpoints } from "../discovery/registry.js";

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

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                count: endpoints.length,
                endpoints: endpoints.map((ep) => ({
                  url: ep.url,
                  method: ep.method,
                  price: ep.price,
                  description: ep.description,
                  scheme: ep.scheme,
                  source: ep.source,
                })),
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
