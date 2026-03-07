import type { WalletProvider } from "./types.js";
import { PrivyWallet } from "./privy-wallet.js";
import { ProxyWallet } from "./proxy-wallet.js";
import { proxyGetWallet } from "./proxy-api.js";
import { createLinkSession, pollLinkStatus } from "./link-api.js";
import { loadConfig, updateConfig } from "../store/config.js";
import { logger } from "../utils/logger.js";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const LOG_REMINDER_INTERVAL_MS = 30_000;

/**
 * Attempt email linking: create a session, show the URL, and poll until complete or timeout.
 * If existingWallet is provided, the email will be linked to that wallet (preserving address/funds).
 * Returns a linked ProxyWallet on success, or null on timeout/error.
 */
async function attemptEmailLinking(
  existingWallet?: { walletId: string; walletSecret: string },
): Promise<ProxyWallet | null> {
  const session = await createLinkSession(existingWallet);

  // Build full URL from relative link_url
  const baseUrl = process.env.X402_PROXY_URL
    ? process.env.X402_PROXY_URL.replace(/\/api\/wallet\/?$/, "")
    : "https://x402.onchainexpat.com";
  const fullUrl = session.link_url.startsWith("http")
    ? session.link_url
    : `${baseUrl}${session.link_url}`;

  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  logger.info("Link your wallet to your email for easy recovery:");
  logger.info(fullUrl);
  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const start = Date.now();
  let lastReminder = start;

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const status = await pollLinkStatus(session.session_id);

    if (status.status === "completed" && status.wallet_id && status.address && status.wallet_secret) {
      const config = loadConfig();
      updateConfig({
        ...config,
        wallet: {
          mode: "linked",
          proxyWalletId: status.wallet_id,
          proxyWalletSecret: status.wallet_secret,
          linkedEmail: status.email || null,
        },
      });

      logger.info(`Wallet linked to ${status.email || "email"}: ${status.address}`);
      return new ProxyWallet(
        status.wallet_id,
        status.wallet_secret,
        status.address,
        "linked",
        status.email,
      );
    }

    if (status.status === "expired") {
      logger.warn("Link session expired");
      return null;
    }

    if (Date.now() - lastReminder >= LOG_REMINDER_INTERVAL_MS) {
      logger.info("Still waiting for email verification...");
      lastReminder = Date.now();
    }
  }

  logger.warn("Email linking timed out after 5 minutes");
  return null;
}

/**
 * Create the wallet.
 * Priority:
 * 1. Privy direct (if env vars set)
 * 2. Existing linked wallet (config.mode="linked")
 * 3. Existing proxy wallet (config.mode="proxy")
 * 4. Attempt email linking (unless X402_SKIP_LINKING is set)
 * 5. Fallback: anonymous proxy wallet
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
      const wallet = await proxyGetWallet(
        config.wallet.proxyWalletId,
        config.wallet.proxyWalletSecret,
      );
      logger.info(`Wallet mode: Linked (${config.wallet.linkedEmail || "email"})`);
      return new ProxyWallet(
        config.wallet.proxyWalletId,
        config.wallet.proxyWalletSecret,
        wallet.address,
        "linked",
        config.wallet.linkedEmail || undefined,
      );
    } catch (err) {
      logger.warn(`Failed to load linked wallet: ${err}. Falling back...`);
    }
  }

  // 3. Existing proxy wallet
  if (config.wallet.mode === "proxy" && config.wallet.proxyWalletId && config.wallet.proxyWalletSecret) {
    try {
      const wallet = await proxyGetWallet(
        config.wallet.proxyWalletId,
        config.wallet.proxyWalletSecret,
      );
      logger.info(`Proxy wallet loaded: ${wallet.address}`);

      // Try email linking for existing proxy wallets too (preserves existing address)
      if (!process.env.X402_SKIP_LINKING) {
        try {
          const linked = await attemptEmailLinking({
            walletId: config.wallet.proxyWalletId!,
            walletSecret: config.wallet.proxyWalletSecret!,
          });
          if (linked) return linked;
        } catch (err) {
          logger.warn(`Email linking failed: ${err}`);
        }
      }

      return new ProxyWallet(
        config.wallet.proxyWalletId,
        config.wallet.proxyWalletSecret,
        wallet.address,
      );
    } catch (err) {
      logger.warn(`Failed to load proxy wallet: ${err}. Creating new...`);
    }
  }

  // 4. Attempt email linking for new wallets
  if (!process.env.X402_SKIP_LINKING) {
    try {
      const linked = await attemptEmailLinking();
      if (linked) return linked;
    } catch (err) {
      logger.warn(`Email linking failed: ${err}`);
    }
  }

  // 5. Fallback: anonymous proxy wallet
  logger.info("Wallet mode: Proxy (zero-config via x402 provisioning service)");
  return ProxyWallet.create();
}
