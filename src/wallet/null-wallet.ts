import type { WalletProvider, WalletInfo } from "./types.js";

const SETUP_MSG =
  "No wallet configured. Use the wallet_link tool to create a wallet linked to your email.";

/**
 * Placeholder wallet returned when no wallet is configured.
 * All payment operations fail with a helpful message directing
 * the user to wallet_link for email-verified setup.
 */
export class NullWallet implements WalletProvider {
  readonly mode = "setup_required" as const;

  getEvmAddress(): string {
    return "0x0000000000000000000000000000000000000000";
  }

  async signTypedData(): Promise<`0x${string}`> {
    throw new Error(SETUP_MSG);
  }

  describe(): WalletInfo {
    return {
      mode: "setup_required",
      evmAddress: "0x0000000000000000000000000000000000000000",
      recoverable: false,
      setupRequired: true,
    };
  }
}
