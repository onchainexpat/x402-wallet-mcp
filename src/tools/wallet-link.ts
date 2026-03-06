import type { WalletProvider } from "../wallet/types.js";
import { createLinkSession } from "../wallet/link-api.js";

export function walletLinkTool(wallet: WalletProvider) {
  return {
    name: "wallet_link",
    description:
      "Link your wallet to an email address for easy recovery. If already linked, shows current status.",
    handler: async () => {
      const info = wallet.describe();

      if (info.mode === "linked" && info.linkedEmail) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "linked",
                  email: info.linkedEmail,
                  evmAddress: info.evmAddress,
                  message: "Wallet is already linked to your email.",
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const session = await createLinkSession();
      const baseUrl = process.env.X402_PROXY_URL
        ? process.env.X402_PROXY_URL.replace(/\/api\/wallet\/?$/, "")
        : "https://x402.onchainexpat.com";
      const fullUrl = session.link_url.startsWith("http")
        ? session.link_url
        : `${baseUrl}${session.link_url}`;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                status: "not_linked",
                link_url: fullUrl,
                instructions:
                  "Open the link above in your browser to link your wallet to an email. After verifying, restart the MCP server to use the linked wallet.",
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
