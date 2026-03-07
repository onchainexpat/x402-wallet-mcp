import type { WalletProvider } from "../wallet/types.js";

export function exportKeyTool(wallet: WalletProvider) {
  return {
    name: "export_key",
    description:
      "Get instructions for exporting your wallet's private key. " +
      "Embedded wallets can be exported at home.privy.io.",
    handler: async () => {
      const info = wallet.describe();

      if (info.walletType === "embedded" || info.linkedEmail) {
        const email = info.linkedEmail || "your linked email";
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  exportable: true,
                  wallet_type: info.walletType || "embedded",
                  instructions: [
                    `1. Go to https://home.privy.io`,
                    `2. Log in with ${email}`,
                    `3. Enter the OTP sent to your email`,
                    `4. Click "Export keys" to view your private key`,
                  ],
                  note: "Your key is exportable even if our server goes offline. Privy holds your key in a secure enclave — only you can export it via email verification.",
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
                exportable: false,
                wallet_type: "server",
                message:
                  "This is a server-managed wallet. Link your email with wallet_link to get an embedded wallet with key export via home.privy.io.",
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
