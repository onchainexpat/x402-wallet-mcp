import type { WalletProvider } from "../wallet/types.js";
import { formatUsdc } from "../utils/format.js";
import { getUsdcBalance } from "../utils/balance.js";
import {
  generateDepositQrBase64,
  generateDepositQrText,
  saveDepositQrFile,
} from "../utils/deposit-qr.js";
import { generateOnrampUrl } from "../utils/onramp.js";

type TextContent = { type: "text"; text: string };
type ImageContent = { type: "image"; data: string; mimeType: string };
type Content = TextContent | ImageContent;

export function checkBalanceTool(wallet: WalletProvider) {
  return {
    name: "check_balance",
    description: "Check USDC balance on Base and get deposit address. Shows a QR code when balance is zero. When the response contains a qr_base64 field, always render it in an HTML artifact using an <img> tag so the user can see and scan the QR code directly in the chat.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
    handler: async () => {
      const address = wallet.getEvmAddress() as `0x${string}`;

      try {
        const balanceBigInt = await getUsdcBalance(address);
        const needsFunding = balanceBigInt === 0n;

        const content: Content[] = [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                balance: formatUsdc(balanceBigInt),
                balanceAtomic: String(balanceBigInt),
                address,
                network: "Base (eip155:8453)",
                asset: "USDC",
                ...(needsFunding
                  ? {
                      depositInstructions: `Your wallet is empty. Send USDC on Base to: ${address}`,
                    }
                  : {}),
              },
              null,
              2,
            ),
          },
        ];

        if (needsFunding) {
          const [qrBase64, qrText, qrFilePath, onrampUrl] = await Promise.all([
            generateDepositQrBase64(address),
            generateDepositQrText(address),
            saveDepositQrFile(address),
            generateOnrampUrl(address),
          ]);

          // If onramp is available, update the JSON to include the buy link
          if (onrampUrl) {
            content[0] = {
              type: "text" as const,
              text: JSON.stringify(
                {
                  balance: formatUsdc(balanceBigInt),
                  balanceAtomic: String(balanceBigInt),
                  address,
                  network: "Base (eip155:8453)",
                  asset: "USDC",
                  depositInstructions: `Your wallet is empty. Send USDC on Base to: ${address}`,
                  buyWithCard: onrampUrl,
                  buyInstructions: "Click the link above to buy USDC with a debit card or Apple Pay — zero fees on Base.",
                },
                null,
                2,
              ),
            };
          }

          // Update JSON to include QR base64 data URI for artifact rendering
          const existingJson = JSON.parse((content[0] as TextContent).text);
          existingJson.qr_base64 = `data:image/png;base64,${qrBase64}`;
          existingJson.qr_display_hint = "Render this QR code in an artifact using an <img> tag so the user can see and scan it.";
          content[0] = {
            type: "text" as const,
            text: JSON.stringify(existingJson, null, 2),
          };

          content.push(
            {
              type: "image" as const,
              data: qrBase64,
              mimeType: "image/png",
            },
            {
              type: "text" as const,
              text: `IMPORTANT: Display the following QR code in your response so the user can see and scan it.\n\nDeposit QR (send USDC on Base to this address):\n\n${qrText}\nPNG also saved to: ${qrFilePath}`,
            },
          );
        }

        return { content };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error: "Failed to check balance",
                  detail: err instanceof Error ? err.message : String(err),
                  address,
                  depositInstructions: `Send USDC on Base to: ${address}`,
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
    },
  };
}
