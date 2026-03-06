import type { WalletProvider, WalletInfo } from "./types.js";
import {
  createWallet as privyCreateWallet,
  getWallet as privyGetWallet,
  signTypedData as privySignTypedData,
} from "./privy-api.js";
import { loadConfig, updateConfig } from "../store/config.js";
import { logger } from "../utils/logger.js";

/**
 * Privy server wallet. Keys never leave Privy's HSM/TEE.
 * Requires PRIVY_APP_ID and PRIVY_APP_SECRET env vars.
 */
export class PrivyWallet implements WalletProvider {
  readonly mode = "privy" as const;
  private walletId: string;
  private address: string;

  constructor(walletId: string, address: string) {
    this.walletId = walletId;
    this.address = address;
  }

  static async create(): Promise<PrivyWallet> {
    const config = loadConfig();

    if (config.wallet.privyWalletId) {
      try {
        const wallet = await privyGetWallet(config.wallet.privyWalletId);
        logger.info(`Privy wallet loaded: ${wallet.address}`);
        return new PrivyWallet(wallet.id, wallet.address);
      } catch (err) {
        logger.warn(`Failed to load Privy wallet ${config.wallet.privyWalletId}: ${err}. Creating new...`);
      }
    }

    const wallet = await privyCreateWallet("ethereum");

    updateConfig({
      ...config,
      wallet: { mode: "privy", privyWalletId: wallet.id },
    });

    logger.info(`Privy wallet created: ${wallet.address}`);
    return new PrivyWallet(wallet.id, wallet.address);
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
    const result = await privySignTypedData(this.walletId, typedData);
    return result.data.signature as `0x${string}`;
  }

  describe(): WalletInfo {
    return {
      mode: "privy",
      evmAddress: this.address,
      recoverable: true,
    };
  }
}
