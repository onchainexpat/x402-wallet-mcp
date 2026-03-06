import type { WalletProvider } from "../wallet/types.js";
import { generateOnrampUrl } from "../utils/onramp.js";
import {
  generateDepositQrBase64,
  generateDepositQrText,
  saveDepositQrFile,
} from "../utils/deposit-qr.js";

type TextContent = { type: "text"; text: string };
type ImageContent = { type: "image"; data: string; mimeType: string };
type Content = TextContent | ImageContent;

export function fundWalletTool(wallet: WalletProvider) {
  return {
    name: "fund_wallet",
    description:
      "Get a link to buy USDC with a debit card or Apple Pay via Coinbase Onramp. " +
      "No crypto experience needed. Falls back to deposit address + QR code if Coinbase Onramp is not configured.",
    inputSchema: {
      type: "object" as const,
      properties: {
        amount: {
          type: "number",
          description: "USD amount to pre-fill (default: 25)",
        },
      },
    },
    handler: async (params?: { amount?: number }) => {
      const amount = params?.amount ?? 25;
      const address = wallet.getEvmAddress();

      const content: Content[] = [];

      // Try Coinbase Onramp first
      const onrampUrl = await generateOnrampUrl(address, amount);

      if (onrampUrl) {
        content.push({
          type: "text" as const,
          text: JSON.stringify(
            {
              fundingMethod: "Coinbase Onramp",
              buyWithCard: onrampUrl,
              amount: `$${amount} USD → USDC on Base`,
              instructions:
                "Click the link above to buy USDC with a debit card or Apple Pay. " +
                "Zero fees for USDC on Base. No crypto experience needed. " +
                "USDC will arrive in your wallet within minutes.",
              address,
              network: "Base (eip155:8453)",
            },
            null,
            2,
          ),
        });
      } else {
        // Fallback: deposit address + QR code
        const [qrBase64, qrText, qrFilePath] = await Promise.all([
          generateDepositQrBase64(address),
          generateDepositQrText(address),
          saveDepositQrFile(address),
        ]);

        content.push(
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                fundingMethod: "Direct deposit",
                address,
                network: "Base (eip155:8453)",
                asset: "USDC",
                instructions: `Send USDC on Base to: ${address}`,
                note: "Coinbase Onramp (buy with debit card) is not configured. Set CDP_API_KEY_ID and CDP_API_KEY_SECRET env vars to enable it.",
                depositQrFile: qrFilePath,
              },
              null,
              2,
            ),
          },
          {
            type: "image" as const,
            data: qrBase64,
            mimeType: "image/png",
          },
          {
            type: "text" as const,
            text: `Deposit QR (send USDC on Base to this address):\n\n${qrText}\nPNG saved to: ${qrFilePath}`,
          },
        );
      }

      return { content };
    },
  };
}
