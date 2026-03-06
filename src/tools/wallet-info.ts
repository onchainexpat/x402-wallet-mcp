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
    description: "Get wallet mode, addresses, and status. Returns a QR code for depositing USDC on Base.",
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

      const recoveryNote =
        "Your wallet is recoverable. Log in with the same email or phone number at https://home.privy.io, enter your 2FA code, and you can see your USDC balance and access your funds anytime.";

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                mode: info.mode,
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
        ],
      };
    },
  };
}
