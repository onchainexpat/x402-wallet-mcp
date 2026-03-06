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
  readonly mode = "proxy" as const;
  private walletId: string;
  private walletSecret: string;
  private address: string;

  constructor(walletId: string, walletSecret: string, address: string) {
    this.walletId = walletId;
    this.walletSecret = walletSecret;
    this.address = address;
  }

  static async create(): Promise<ProxyWallet> {
    const config = loadConfig();

    if (config.wallet.proxyWalletId && config.wallet.proxyWalletSecret) {
      try {
        const wallet = await proxyGetWallet(
          config.wallet.proxyWalletId,
          config.wallet.proxyWalletSecret,
        );
        logger.info(`Proxy wallet loaded: ${wallet.address}`);
        return new ProxyWallet(
          config.wallet.proxyWalletId,
          config.wallet.proxyWalletSecret,
          wallet.address,
        );
      } catch (err) {
        logger.warn(
          `Failed to load proxy wallet ${config.wallet.proxyWalletId}: ${err}. Creating new...`,
        );
      }
    }

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

  getEvmAddress(): string {
    return this.address;
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
    );
    return result.signature as `0x${string}`;
  }

  describe(): WalletInfo {
    return {
      mode: "proxy",
      evmAddress: this.address,
      recoverable: true,
    };
  }
}
