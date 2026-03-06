import { loadConfig, updateConfig } from "../store/config.js";

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function manageAllowlistTool() {
  return {
    name: "manage_allowlist",
    description:
      "View or update the merchant address allowlist. " +
      "Add trusted merchant addresses, remove them, or toggle the allowlist on/off. " +
      "When enabled, only allowlisted merchants can receive payments.",
    handler: async (params: {
      allow?: string;
      remove?: string;
      mode?: string;
    }) => {
      const config = loadConfig();
      const allowlist = { ...config.allowlist };

      if (params.mode === "off") {
        allowlist.enabled = false;
        updateConfig({ ...config, allowlist });
      } else if (params.mode === "on") {
        allowlist.enabled = true;
        updateConfig({ ...config, allowlist });
      }

      if (params.allow) {
        if (!ETH_ADDRESS_RE.test(params.allow)) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { error: `Invalid Ethereum address: ${params.allow}` },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }
        const normalized = params.allow.toLowerCase();
        if (!allowlist.merchants.includes(normalized)) {
          allowlist.merchants = [...allowlist.merchants, normalized];
          updateConfig({ ...config, allowlist });
        }
      }

      if (params.remove) {
        const normalized = params.remove.toLowerCase();
        allowlist.merchants = allowlist.merchants.filter(
          (m) => m !== normalized,
        );
        updateConfig({ ...config, allowlist });
      }

      // Re-read after mutations
      const current = loadConfig();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                enabled: current.allowlist.enabled,
                merchantCount: current.allowlist.merchants.length,
                merchants: current.allowlist.merchants,
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
