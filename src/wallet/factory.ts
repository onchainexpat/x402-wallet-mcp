import type { WalletProvider } from "./types.js";
import { PrivyWallet } from "./privy-wallet.js";
import { logger } from "../utils/logger.js";

/**
 * Create the wallet. Privy-only — requires PRIVY_APP_ID and PRIVY_APP_SECRET.
 */
export async function createWallet(): Promise<WalletProvider> {
  logger.info("Wallet mode: Privy (server-managed keys)");
  return PrivyWallet.create();
}
