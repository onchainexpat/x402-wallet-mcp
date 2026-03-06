/** USDC contract addresses by chain */
export const USDC_ADDRESSES: Record<number, `0x${string}`> = {
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base Mainnet
  84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia
};

/** Default chain for EVM payments */
export const DEFAULT_CHAIN_ID = 8453;

/** Solana USDC mint */
export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** CAIP-2 network -> (SDK network name, chain ID) */
export const NETWORK_MAP: Record<string, [string, number]> = {
  "eip155:8453": ["base", 8453],
  "eip155:84532": ["base-sepolia", 84532],
  base: ["base", 8453],
  "base-sepolia": ["base-sepolia", 84532],
};

/** Escrow contract addresses (Base Mainnet) */
export const ESCROW_ADDRESSES = {
  paymentOperator: "0xB5337C63D5bC8561CbE1F36aC4f6A366F72BCAF7" as `0x${string}`,
  tokenCollector: "0x32d6AC59BCe8DFB3026F10BcaDB8D00AB218f5b6" as `0x${string}`,
  escrow: "0x320a3c35F131E5D2Fb36af56345726B298936037" as `0x${string}`,
};

/** Maximum uint48 value for escrow timestamps */
export const MAX_UINT48 = 281474976710655;

/** ERC-20 balance ABI fragment */
export const ERC20_BALANCE_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/** Default RPC URL */
export const DEFAULT_RPC_URL = "https://mainnet.base.org";
