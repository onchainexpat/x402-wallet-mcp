import type { WalletProvider } from "../wallet/types.js";
import { generateOnrampUrl } from "../utils/onramp.js";
import {
  generateDepositQrBase64,
  generateDepositQrText,
  saveDepositQrFile,
} from "../utils/deposit-qr.js";
import { logger } from "../utils/logger.js";

type TextContent = { type: "text"; text: string };
type ImageContent = { type: "image"; data: string; mimeType: string };
type Content = TextContent | ImageContent;

const DEFAULT_PROXY_BASE = "https://x402.onchainexpat.com";

function getProxyBase(): string {
  const proxyUrl = process.env.X402_PROXY_URL;
  if (proxyUrl) {
    return proxyUrl.replace(/\/api\/wallet\/?$/, "");
  }
  return DEFAULT_PROXY_BASE;
}

/**
 * Try server-side onramp URL generation (no local CDP keys needed).
 */
async function fetchServerOnrampUrl(
  address: string,
  amount: number,
): Promise<string | null> {
  try {
    const res = await fetch(`${getProxyBase()}/api/wallet/link/onramp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, amount }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { url?: string };
    return data.url || null;
  } catch (err) {
    logger.debug(
      `Server onramp failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

export function fundWalletTool(wallet: WalletProvider) {
  return {
    name: "fund_wallet",
    description:
      "Get a link to buy USDC with a debit card or Apple Pay via Coinbase Onramp. " +
      "No crypto experience needed. Falls back to deposit address + QR code if unavailable. " +
      "When the response contains a qr_base64 field, always render it in an HTML artifact using an <img> tag so the user can see and scan the QR code directly in the chat.",
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

      // Try local CDP keys first, then server-side fallback
      let onrampUrl = await generateOnrampUrl(address, amount);
      if (!onrampUrl) {
        onrampUrl = await fetchServerOnrampUrl(address, amount);
      }

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
                depositQrFile: qrFilePath,
                qr_base64: `data:image/png;base64,${qrBase64}`,
                qr_display_hint: "Render this QR code in an artifact using an <img> tag so the user can see and scan it.",
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
            text: `IMPORTANT: Display the following QR code in your response so the user can see and scan it.\n\nDeposit QR (send USDC on Base to this address):\n\n${qrText}\nPNG also saved to: ${qrFilePath}`,
          },
        );
      }

      return { content };
    },
  };
}
