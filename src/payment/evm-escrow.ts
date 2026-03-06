/**
 * EVM Escrow payment signing — EIP-3009 ReceiveWithAuthorization.
 * Port of scripts/daily_x402_test.py:sign_escrow_payment (lines 295-421)
 * and compute_escrow_nonce (lines 165-208).
 */

import { randomBytes } from "node:crypto";
import {
  keccak256,
  encodePacked,
  encodeAbiParameters,
  parseAbiParameters,
  toHex,
  type Address,
} from "viem";
import type { WalletProvider } from "../wallet/types.js";
import type { AcceptEntry, EscrowPaymentPayload, Authorization, PaymentInfo } from "./types.js";
import { DEFAULT_CHAIN_ID, ESCROW_ADDRESSES, MAX_UINT48 } from "./constants.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

const RECEIVE_WITH_AUTH_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

/** PaymentInfo typehash — must match AuthCaptureEscrow.getHash() */
const PAYMENT_INFO_TYPEHASH = keccak256(
  new TextEncoder().encode(
    "PaymentInfo(address operator,address payer,address receiver,address token,uint120 maxAmount,uint48 preApprovalExpiry,uint48 authorizationExpiry,uint48 refundExpiry,uint16 minFeeBps,uint16 maxFeeBps,address feeReceiver,uint256 salt)",
  ),
);

/**
 * Compute deterministic escrow nonce.
 * Must match AuthCaptureEscrow.getHash() with payer=address(0).
 */
export function computeEscrowNonce(
  chainId: number,
  escrowAddress: string,
  paymentInfo: PaymentInfo,
): `0x${string}` {
  // Step 1: Encode paymentInfo with payer=0x0 (payer-agnostic)
  const paymentInfoEncoded = encodeAbiParameters(
    parseAbiParameters(
      "bytes32, address, address, address, address, uint120, uint48, uint48, uint48, uint16, uint16, address, uint256",
    ),
    [
      PAYMENT_INFO_TYPEHASH,
      paymentInfo.operator as Address,
      ZERO_ADDRESS, // payer-agnostic
      paymentInfo.receiver as Address,
      paymentInfo.token as Address,
      BigInt(paymentInfo.maxAmount),
      paymentInfo.preApprovalExpiry,
      paymentInfo.authorizationExpiry,
      paymentInfo.refundExpiry,
      paymentInfo.minFeeBps,
      paymentInfo.maxFeeBps,
      paymentInfo.feeReceiver as Address,
      BigInt(paymentInfo.salt),
    ],
  );

  const paymentInfoHash = keccak256(paymentInfoEncoded);

  // Step 2: Encode (chainId, escrow, paymentInfoHash) and hash
  const outerEncoded = encodeAbiParameters(
    parseAbiParameters("uint256, address, bytes32"),
    [BigInt(chainId), escrowAddress as Address, paymentInfoHash],
  );

  return keccak256(outerEncoded);
}

export async function signEscrowPayment(
  wallet: WalletProvider,
  accept: AcceptEntry,
): Promise<string> {
  const extra = accept.extra ?? {};
  const amount = accept.maxAmountRequired ?? accept.amount;
  const asset = accept.asset;
  const tokenName = extra.name ?? "USD Coin";
  const tokenVersion = extra.version ?? "2";
  const operatorAddress = extra.operatorAddress as string;
  const escrowAddress = extra.escrowAddress ?? ESCROW_ADDRESSES.escrow;
  const tokenCollector = extra.tokenCollector as string;

  // Generate salt
  const saltHex = `0x${randomBytes(32).toString("hex")}`;

  // Build PaymentInfo (payer-agnostic for nonce computation)
  const paymentInfo: PaymentInfo = {
    operator: operatorAddress,
    receiver: accept.payTo,
    token: asset,
    maxAmount: String(amount),
    preApprovalExpiry: MAX_UINT48,
    authorizationExpiry: MAX_UINT48,
    refundExpiry: MAX_UINT48,
    minFeeBps: (extra.minFeeBps as number) ?? 0,
    maxFeeBps: (extra.maxFeeBps as number) ?? 0,
    feeReceiver: operatorAddress,
    salt: saltHex,
  };

  // Compute deterministic nonce
  const nonce = computeEscrowNonce(
    DEFAULT_CHAIN_ID,
    escrowAddress as string,
    paymentInfo,
  );

  // Sign ReceiveWithAuthorization (to = tokenCollector, NOT payTo)
  const domain = {
    name: tokenName,
    version: tokenVersion,
    chainId: BigInt(DEFAULT_CHAIN_ID),
    verifyingContract: asset as `0x${string}`,
  };

  const message = {
    from: wallet.getEvmAddress() as `0x${string}`,
    to: tokenCollector as `0x${string}`,
    value: BigInt(amount),
    validAfter: 0n,
    validBefore: BigInt(MAX_UINT48),
    nonce: nonce as `0x${string}`,
  };

  const signature = await wallet.signTypedData(
    domain,
    RECEIVE_WITH_AUTH_TYPES,
    "ReceiveWithAuthorization",
    message as unknown as Record<string, unknown>,
  );

  const authorization: Authorization = {
    from: wallet.getEvmAddress(),
    to: tokenCollector as string,
    value: String(amount),
    validAfter: "0",
    validBefore: String(MAX_UINT48),
    nonce,
  };

  const paymentPayload: EscrowPaymentPayload = {
    x402Version: 2,
    scheme: "escrow",
    network: "eip155:8453",
    payload: {
      authorization,
      signature,
      paymentInfo,
    },
    resource: { method: "POST" },
    accepted: {
      scheme: "escrow",
      network: "eip155:8453",
      amount: String(amount),
      payTo: accept.payTo,
      asset,
      maxTimeoutSeconds: accept.maxTimeoutSeconds ?? 60,
      extra,
    },
  };

  return btoa(JSON.stringify(paymentPayload));
}
