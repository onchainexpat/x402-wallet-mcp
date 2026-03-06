import type { TypedDataDomain } from "viem";

export type WalletMode = "privy";

export interface WalletProvider {
  mode: WalletMode;

  /** Get the EVM (Base) address */
  getEvmAddress(): string;

  /** Sign EIP-712 typed data and return hex signature */
  signTypedData(
    domain: TypedDataDomain,
    types: Record<string, Array<{ name: string; type: string }>>,
    primaryType: string,
    message: Record<string, unknown>,
  ): Promise<`0x${string}`>;

  /** Describe the wallet for display */
  describe(): WalletInfo;
}

export interface WalletInfo {
  mode: WalletMode;
  evmAddress: string;
  recoverable: boolean;
}
