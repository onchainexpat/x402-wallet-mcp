import type { WalletProvider } from "../wallet/types.js";
import {
  generateDepositQrBase64,
  generateDepositQrText,
  saveDepositQrFile,
} from "../utils/deposit-qr.js";
import { generateOnrampUrl } from "../utils/onramp.js";

export function walletInfoTool(wallet: WalletProvider) {
  return {
    name: "wallet_info",
    description: "Get wallet mode, addresses, and status. Returns a QR code for depositing USDC on Base. When the response contains a qr_base64 field, always render it in an HTML artifact using an <img> tag so the user can see and scan the QR code directly in the chat.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
    handler: async () => {
      const info = wallet.describe();
      const [qrBase64, qrText, qrFilePath, onrampUrl] = await Promise.all([
        generateDepositQrBase64(info.evmAddress),
        generateDepositQrText(info.evmAddress),
        saveDepositQrFile(info.evmAddress),
        generateOnrampUrl(info.evmAddress),
      ]);

      const isEmbedded = info.walletType === "embedded";
      const recoveryNote =
        info.mode === "linked"
          ? isEmbedded
            ? `Embedded wallet linked to ${info.linkedEmail || "your email"}. Key exportable at https://home.privy.io — your funds are safe even if our server goes offline.`
            : `Wallet linked to ${info.linkedEmail || "your email"}. You can recover it by verifying the same email address. Your wallet_secret in ~/.x402-wallet/config.json is a backup — keep it safe.`
          : info.mode === "proxy"
            ? "No private key is stored on your machine — your key lives in Privy's HSM. Link your email with wallet_link to enable recovery on any device and key export at https://home.privy.io."
            : "Your wallet is recoverable. Log in with your email at https://home.privy.io to export your private key or access your funds — even if this tool or our server goes offline.";

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                mode: info.mode,
                walletType: info.walletType || "server",
                evmAddress: info.evmAddress,
                recoverable: info.recoverable,
                recoveryNote,
                depositInstructions: "Send USDC on Base to the address above. Scan the QR code with any Ethereum wallet.",
                ...(onrampUrl
                  ? {
                      buyWithCard: onrampUrl,
                      buyInstructions: "Click the link above to buy USDC with a debit card or Apple Pay — zero fees on Base.",
                    }
                  : {}),
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
        ],
      };
    },
  };
}
