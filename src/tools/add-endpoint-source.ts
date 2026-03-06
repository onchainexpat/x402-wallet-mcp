import { loadConfig, saveConfig } from "../store/config.js";
import { fetchWellKnown } from "../discovery/well-known.js";
import { probeEndpoint } from "../payment/negotiator.js";

export function addEndpointSourceTool() {
  return {
    name: "add_endpoint_source",
    description:
      "Add x402 endpoints. Pass a base_url to add a .well-known/x402 discovery source, or pass endpoint_url to add a single API endpoint directly.",
    inputSchema: {
      type: "object" as const,
      properties: {
        base_url: {
          type: "string",
          description:
            "Base URL of a server with .well-known/x402 (e.g. 'https://api.example.com'). Fetches all endpoints from its discovery document.",
        },
        endpoint_url: {
          type: "string",
          description:
            "Direct URL of a single x402 endpoint (e.g. 'https://api.example.com/v1/search'). Probes it and adds to your list.",
        },
        description: {
          type: "string",
          description: "Optional description for a custom endpoint.",
        },
      },
    },
    handler: async (params: {
      base_url?: string;
      endpoint_url?: string;
      description?: string;
    }) => {
      const config = loadConfig();

      // Mode 1: Add a discovery source
      if (params.base_url) {
        const baseUrl = params.base_url.replace(/\/$/, "");

        if (config.endpointSources.includes(baseUrl)) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    status: "already_exists",
                    message: `${baseUrl} is already in your endpoint sources`,
                    sources: config.endpointSources,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        const endpoints = await fetchWellKnown(baseUrl);
        config.endpointSources.push(baseUrl);
        saveConfig(config);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "added_source",
                  source: baseUrl,
                  endpointsFound: endpoints.length,
                  totalSources: config.endpointSources.length,
                  sources: config.endpointSources,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // Mode 2: Add a single endpoint URL
      if (params.endpoint_url) {
        const url = params.endpoint_url.replace(/\/$/, "");
        const existing = (config.customEndpoints ?? []).find(
          (ep) => ep.url === url,
        );

        if (existing) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    status: "already_exists",
                    message: `${url} is already in your custom endpoints`,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // Probe the endpoint to see if it's actually x402
        let probeResult: { price?: string; scheme?: string } = {};
        try {
          const info = await probeEndpoint(url);
          if (info && info.accepts?.length > 0) {
            probeResult = {
              price: info.accepts[0].amount,
              scheme: info.accepts[0].scheme,
            };
          }
        } catch {
          // Non-fatal — still add it
        }

        if (!config.customEndpoints) config.customEndpoints = [];
        config.customEndpoints.push({
          url,
          description: params.description,
        });
        saveConfig(config);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "added_endpoint",
                  url,
                  description: params.description ?? null,
                  probe: probeResult.price
                    ? {
                        price: probeResult.price,
                        scheme: probeResult.scheme,
                        is402: true,
                      }
                    : { is402: false, note: "Could not confirm this is an x402 endpoint. It was added anyway." },
                  totalCustomEndpoints: config.customEndpoints.length,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                error: "Provide either base_url (discovery source) or endpoint_url (single endpoint)",
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
