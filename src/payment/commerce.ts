/**
 * x402r "commerce" payments: funds go into an escrow contract and are
 * captured (or refunded) by the merchant's operator after the response.
 * x402r called this scheme "escrow" until 2026-04-23; servers using either
 * name are paid the same way.
 */

import type { AcceptEntry } from "./types.js";

export const COMMERCE_SCHEMES = ["commerce", "escrow"] as const;
export type CommerceScheme = (typeof COMMERCE_SCHEMES)[number];

export function isCommerceScheme(scheme: unknown): scheme is CommerceScheme {
  return (COMMERCE_SCHEMES as readonly unknown[]).includes(scheme);
}

/**
 * Escrow contract + token collector pairs on Base that we will sign for.
 * Published in @x402r/core, and checked on-chain on 2026-11-03: each
 * collector's authCaptureEscrow() returns the escrow listed with it.
 *
 * The signed ReceiveWithAuthorization names the token collector as its
 * recipient, and ERC-3009 lets that recipient redeem it directly. So a
 * collector taken from the server unchecked would let any server collect the
 * payment itself, whatever payTo the merchant allowlist approved.
 */
export const BASE_COMMERCE_DEPLOYMENTS = [
  {
    name: "x402r",
    escrow: "0xb9488351E48b23D798f24e8174514F28B741Eb4f",
    tokenCollector: "0x48ADf6E37F9b31dC2AAD0462C5862B5422C736B8",
  },
  {
    name: "x402r (earlier deployment)",
    escrow: "0x320a3c35F131E5D2Fb36af56345726B298936037",
    tokenCollector: "0x32d6AC59BCe8DFB3026F10BcaDB8D00AB218f5b6",
  },
] as const;

const BASE_NETWORKS = new Set(["eip155:8453", "base"]);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export class CommerceTermsError extends Error {}

export interface CommerceContracts {
  escrowAddress: string;
  tokenCollector: string;
  operatorAddress: string;
}

/** The contracts to sign for, or a CommerceTermsError saying why not. */
export function resolveCommerceContracts(accept: AcceptEntry): CommerceContracts {
  if (!BASE_NETWORKS.has(accept.network)) {
    throw new CommerceTermsError(`Commerce payments are only supported on Base, not ${accept.network}`);
  }
  const extra = accept.extra ?? {};

  const collector = extra.tokenCollector;
  const deployment =
    typeof collector === "string"
      ? BASE_COMMERCE_DEPLOYMENTS.find((d) => d.tokenCollector.toLowerCase() === collector.toLowerCase())
      : undefined;
  if (!deployment) {
    throw new CommerceTermsError(
      `Unknown token collector ${JSON.stringify(collector)}; only x402r's published Base collectors are trusted`,
    );
  }

  const escrow = extra.escrowAddress;
  if (escrow !== undefined && (typeof escrow !== "string" || escrow.toLowerCase() !== deployment.escrow.toLowerCase())) {
    throw new CommerceTermsError(
      `Escrow ${JSON.stringify(escrow)} does not belong to token collector ${deployment.tokenCollector}`,
    );
  }

  const operator = extra.operatorAddress;
  if (typeof operator !== "string" || !ADDRESS.test(operator)) {
    throw new CommerceTermsError(`Commerce payment option has no valid operatorAddress: ${JSON.stringify(operator)}`);
  }

  return { escrowAddress: deployment.escrow, tokenCollector: deployment.tokenCollector, operatorAddress: operator };
}
