import type { WalletProvider, WalletInfo } from "./types.js";
import {
  proxyCreateWallet,
  proxyGetWallet,
  proxySignTypedData,
} from "./proxy-api.js";
import { loadConfig, updateConfig } from "../store/config.js";
import { logger } from "../utils/logger.js";

/**
 * Proxy wallet backed by Privy HSM via the x402 provisioning service.
 * Zero-config: no Privy credentials needed on the client side.
 */
export class ProxyWallet implements WalletProvider {
  readonly mode: "proxy" | "linked";
  private walletId: string;
  private walletSecret: string;
  private address: string;
  private email?: string;
  private walletType?: "server" | "embedded";
  private allowlistToken?: string;

  constructor(
    walletId: string,
    walletSecret: string,
    address: string,
    mode: "proxy" | "linked" = "proxy",
    email?: string,
    walletType?: "server" | "embedded",
    allowlistToken?: string,
  ) {
    this.walletId = walletId;
    this.walletSecret = walletSecret;
    this.address = address;
    this.mode = mode;
    this.email = email;
    this.walletType = walletType;
    this.allowlistToken = allowlistToken;
  }

  /**
   * Load an existing wallet from config. Throws if no wallet in config
   * OR if the API call to verify it fails. Never creates a new wallet.
   */
  static async load(): Promise<ProxyWallet> {
    const config = loadConfig();

    if (!config.wallet.proxyWalletId || !config.wallet.proxyWalletSecret) {
      throw new Error("No proxy wallet found in config");
    }

    const wallet = await proxyGetWallet(
      config.wallet.proxyWalletId,
      config.wallet.proxyWalletSecret,
    );
    logger.info(`Proxy wallet loaded: ${wallet.address}`);
    return new ProxyWallet(
      config.wallet.proxyWalletId,
      config.wallet.proxyWalletSecret,
      wallet.address,
      config.wallet.mode === "linked" ? "linked" : "proxy",
      config.wallet.linkedEmail || undefined,
      config.wallet.walletType || undefined,
      config.wallet.allowlistToken || undefined,
    );
  }

  /**
   * Explicitly create a brand-new wallet via the provisioning service.
   * Only call when we're certain no existing wallet should be preserved.
   */
  static async createNew(): Promise<ProxyWallet> {
    const config = loadConfig();
    const result = await proxyCreateWallet();

    updateConfig({
      ...config,
      wallet: {
        mode: "proxy",
        proxyWalletId: result.wallet_id,
        proxyWalletSecret: result.wallet_secret,
      },
    });

    logger.info(`Proxy wallet created: ${result.address}`);
    return new ProxyWallet(result.wallet_id, result.wallet_secret, result.address);
  }

  /**
   * Backward-compatible create: loads existing if config has wallet ID,
   * otherwise creates new. If load fails, throws instead of silently
   * creating a replacement.
   */
  static async create(): Promise<ProxyWallet> {
    const config = loadConfig();

    if (config.wallet.proxyWalletId && config.wallet.proxyWalletSecret) {
      // Existing wallet — load or throw, never replace
      return ProxyWallet.load();
    }

    // No existing wallet — safe to create new
    return ProxyWallet.createNew();
  }

  getEvmAddress(): string {
    return this.address;
  }

  getProxyCredentials(): { walletId: string; walletSecret: string } {
    return { walletId: this.walletId, walletSecret: this.walletSecret };
  }

  async signTypedData(
    domain: Record<string, unknown>,
    types: Record<string, Array<{ name: string; type: string }>>,
    primaryType: string,
    message: Record<string, unknown>,
  ): Promise<`0x${string}`> {
    const typedData = { domain, types, primaryType, message };
    const result = await proxySignTypedData(
      this.walletId,
      this.walletSecret,
      typedData,
      this.allowlistToken,
    );
    return result.signature as `0x${string}`;
  }

  describe(): WalletInfo {
    return {
      mode: this.mode,
      evmAddress: this.address,
      recoverable: true,
      ...(this.email ? { linkedEmail: this.email } : {}),
      ...(this.walletType ? { walletType: this.walletType } : {}),
    };
  }
}
