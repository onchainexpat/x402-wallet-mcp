/**
 * EVM Exact payment signing — EIP-3009 TransferWithAuthorization.
 * Port of scripts/daily_x402_test.py:sign_eip3009_payment (lines 211-292).
 */

import { randomBytes } from "node:crypto";
import type { WalletProvider } from "../wallet/types.js";
import type { AcceptEntry, ExactPaymentPayload, Authorization } from "./types.js";
import { NETWORK_MAP } from "./constants.js";

const TRANSFER_WITH_AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

export async function signExactPayment(
  wallet: WalletProvider,
  accept: AcceptEntry,
): Promise<string> {
  const rawNetwork = accept.network;
  let sdkNetwork: string;
  let chainId: number;

  if (rawNetwork in NETWORK_MAP) {
    [sdkNetwork, chainId] = NETWORK_MAP[rawNetwork];
  } else {
    // Fallback: extract chain ID from "eip155:<id>"
    chainId = parseInt(rawNetwork.split(":").pop()!, 10);
    sdkNetwork = rawNetwork;
  }

  const amount = accept.amount;
  const payTo = accept.payTo;
  const asset = accept.asset;
  const maxTimeout = accept.maxTimeoutSeconds ?? 60;
  const extra = accept.extra ?? {};
  const tokenName = extra.name ?? "USD Coin";
  const tokenVersion = extra.version ?? "2";

  const now = Math.floor(Date.now() / 1000);
  const nonceBytes = randomBytes(32);
  const nonceHex = `0x${nonceBytes.toString("hex")}`;

  const domain = {
    name: tokenName,
    version: tokenVersion,
    chainId: BigInt(chainId),
    verifyingContract: asset as `0x${string}`,
  };

  const message = {
    from: wallet.getEvmAddress() as `0x${string}`,
    to: payTo as `0x${string}`,
    value: BigInt(amount),
    validAfter: BigInt(now - 60),
    validBefore: BigInt(now + maxTimeout),
    nonce: nonceHex as `0x${string}`,
  };

  const signature = await wallet.signTypedData(
    domain,
    TRANSFER_WITH_AUTH_TYPES,
    "TransferWithAuthorization",
    message as unknown as Record<string, unknown>,
  );

  const authorization: Authorization = {
    from: wallet.getEvmAddress(),
    to: payTo,
    value: amount,
    validAfter: String(now - 60),
    validBefore: String(now + maxTimeout),
    nonce: nonceHex,
  };

  const paymentPayload: ExactPaymentPayload = {
    x402Version: 1,
    scheme: "exact",
    network: sdkNetwork,
    payload: {
      signature,
      authorization,
    },
  };

  return btoa(JSON.stringify(paymentPayload));
}
