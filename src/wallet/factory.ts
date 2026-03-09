import type { WalletProvider } from "./types.js";
import { PrivyWallet } from "./privy-wallet.js";
import { ProxyWallet } from "./proxy-wallet.js";
import { NullWallet } from "./null-wallet.js";
import { proxyGetWallet } from "./proxy-api.js";
import { loadConfig } from "../store/config.js";
import { logger } from "../utils/logger.js";

const RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 3000;

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number = RETRY_ATTEMPTS,
  delayMs: number = RETRY_DELAY_MS,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts) {
        logger.warn(`Attempt ${i + 1} failed: ${err instanceof Error ? err.message : err}. Retrying in ${delayMs / 1000}s...`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
}

/**
 * Create the wallet.
 * Priority:
 * 1. Privy direct (if env vars set)
 * 2. Existing linked wallet (config.mode="linked")
 * 3. Existing proxy wallet (config.mode="proxy")
 * 4. Fallback: anonymous proxy wallet
 *
 * Email linking/recovery is handled interactively via the wallet_link
 * and wallet_recover MCP tools (no background polling).
 */
export async function createWallet(): Promise<WalletProvider> {
  // 1. Privy direct
  if (process.env.PRIVY_APP_ID && process.env.PRIVY_APP_SECRET) {
    logger.info("Wallet mode: Privy (server-managed keys)");
    return PrivyWallet.create();
  }

  const config = loadConfig();

  // 2. Existing linked wallet
  if (config.wallet.mode === "linked" && config.wallet.proxyWalletId && config.wallet.proxyWalletSecret) {
    try {
      const wallet = await withRetry(() =>
        proxyGetWallet(
          config.wallet.proxyWalletId!,
          config.wallet.proxyWalletSecret!,
        ),
      );
      logger.info(`Wallet mode: Linked (${config.wallet.linkedEmail || "email"})`);
      return new ProxyWallet(
        config.wallet.proxyWalletId,
        config.wallet.proxyWalletSecret,
        wallet.address,
        "linked",
        config.wallet.linkedEmail || undefined,
        config.wallet.walletType || undefined,
        config.wallet.allowlistToken || undefined,
      );
    } catch (err) {
      const lastMsg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Could not load linked wallet (${config.wallet.proxyWalletId}).\n` +
        `  Last error: ${lastMsg}\n` +
        `  Your wallet is safe — it has NOT been replaced.\n` +
        `  To fix:\n` +
        `  - If the service is down, try again later\n` +
        `  - Use the wallet_recover tool with your linked email to recover\n` +
        `  - If config is corrupted, restore from ~/.x402-wallet/config.json.bak`,
      );
    }
  }

  // 3. Existing proxy wallet
  if (config.wallet.proxyWalletId && config.wallet.proxyWalletSecret) {
    try {
      const wallet = await withRetry(() =>
        proxyGetWallet(
          config.wallet.proxyWalletId!,
          config.wallet.proxyWalletSecret!,
        ),
      );
      logger.info(`Proxy wallet loaded: ${wallet.address}`);
      return new ProxyWallet(
        config.wallet.proxyWalletId,
        config.wallet.proxyWalletSecret,
        wallet.address,
        "proxy",
        undefined,
        undefined,
        config.wallet.allowlistToken || undefined,
      );
    } catch (err) {
      const lastMsg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Could not load proxy wallet (${config.wallet.proxyWalletId}).\n` +
        `  Last error: ${lastMsg}\n` +
        `  Your wallet is safe — it has NOT been replaced.\n` +
        `  To fix:\n` +
        `  - If the service is down, try again later\n` +
        `  - Use the wallet_link tool to link your email for recovery\n` +
        `  - If config is corrupted, restore from ~/.x402-wallet/config.json.bak`,
      );
    }
  }

  // 4. No wallet configured — require email linking
  logger.info("No wallet configured. Use the wallet_link tool to create one linked to your email.");
  return new NullWallet();
}
