import type { WalletProvider } from "./types.js";
import { PrivyWallet } from "./privy-wallet.js";
import { ProxyWallet } from "./proxy-wallet.js";
import { logger } from "../utils/logger.js";

/**
 * Create the wallet.
 * Priority: Privy direct (if env vars set) -> Proxy (zero-config default)
 */
export async function createWallet(): Promise<WalletProvider> {
  if (process.env.PRIVY_APP_ID && process.env.PRIVY_APP_SECRET) {
    logger.info("Wallet mode: Privy (server-managed keys)");
    return PrivyWallet.create();
  }

  logger.info("Wallet mode: Proxy (zero-config via x402 provisioning service)");
  return ProxyWallet.create();
}
