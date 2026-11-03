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
import { DEFAULT_CHAIN_ID, MAX_UINT48 } from "./constants.js";
import { resolveCommerceContracts } from "./commerce.js";
import { resolveAcceptAmount } from "./amount.js";
import { authorizationWindowSeconds } from "./window.js";

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
  const amount = String(resolveAcceptAmount(accept));
  const asset = accept.asset;
  const tokenName = extra.name ?? "USD Coin";
  const tokenVersion = extra.version ?? "2";
  // Only known x402r contracts on Base; throws for anything else.
  const { escrowAddress, tokenCollector, operatorAddress } = resolveCommerceContracts(accept);
  // Answer in the scheme name the server offered ("commerce", or legacy "escrow").
  const scheme = accept.scheme === "escrow" ? "escrow" : "commerce";

  // Generate salt
  const saltHex = `0x${randomBytes(32).toString("hex")}`;

  // The signed authorization only has to last until the server settles, which
  // it promises within maxTimeoutSeconds. The escrow contract hands
  // preApprovalExpiry to receiveWithAuthorization as validBefore, so the two
  // must be the same number. (Both used to be MAX_UINT48: a never-expiring
  // authorization if the server held on to it.)
  // authorizationExpiry (the merchant's deadline to capture) and refundExpiry
  // stay open-ended: servers require a long capture window (padelmaps.org
  // refuses under 24h) and a long refund window only protects the payer.
  const preApprovalExpiry =
    Math.floor(Date.now() / 1000) + authorizationWindowSeconds(accept.maxTimeoutSeconds);

  // Build PaymentInfo (payer-agnostic for nonce computation)
  const paymentInfo: PaymentInfo = {
    operator: operatorAddress,
    receiver: accept.payTo,
    token: asset,
    maxAmount: String(amount),
    preApprovalExpiry,
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
    validBefore: BigInt(preApprovalExpiry),
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
    validBefore: String(preApprovalExpiry),
    nonce,
  };

  const paymentPayload: EscrowPaymentPayload = {
    x402Version: 2,
    scheme,
    network: "eip155:8453",
    payload: {
      authorization,
      signature,
      paymentInfo,
    },
    resource: { method: "POST" },
    accepted: {
      scheme,
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
