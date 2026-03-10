/**
 * Shared USDC balance utility.
 * Used by both check-balance tool and payment negotiator pre-flight check.
 */

import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { ERC20_BALANCE_ABI, USDC_ADDRESSES, DEFAULT_RPC_URL } from "../payment/constants.js";

/** Fetch on-chain USDC balance for an address on Base. Returns atomic units. */
export async function getUsdcBalance(address: `0x${string}`): Promise<bigint> {
  const rpcUrl = process.env.X402_RPC_URL || DEFAULT_RPC_URL;
  const client = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });

  const balance = await client.readContract({
    address: USDC_ADDRESSES[8453],
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: [address],
  });

  return balance as bigint;
}
