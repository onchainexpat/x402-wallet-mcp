/**
 * Optional local pre-sign check with x402-spotcheck (off by default).
 *
 * Enable by setting X402_SPOTCHECK_LISTINGS to a JSON file that maps endpoint URLs
 * to the terms you expect: { "<url>": { "price": 0.01, "payTo": "0x…", "network": "eip155:8453" } }.
 * The chosen accept entry is compared with that listing before signing (local mode:
 * no network calls). Base mainnet only; other networks pass through. A different
 * payTo or network, a non-USDC asset, or a price more than 1% above the listing is
 * refused. A cheaper price is fine. Anything unknown (no listing, unreadable file,
 * package not installed, check error) fails open: the payment proceeds as before.
 *
 * x402-spotcheck is an optional peer dependency:
 *   npm i github:withgrokbot/x402-spotcheck#v1.0.0
 */

import { readFileSync } from "node:fs";
import type { AcceptEntry, PaymentRequired } from "./types.js";
import { logger } from "../utils/logger.js";

export interface SpotCheckListing {
  price?: number;
  payTo?: string;
  network?: string;
}

export interface SpotCheckResult {
  allowed: boolean;
  reason?: string;
}

export type SpotCheckGate = (input: {
  url: string;
  method: string;
  accept: AcceptEntry;
  paymentRequired: PaymentRequired;
}) => Promise<SpotCheckResult>;

type HookFactory = (opts: {
  mode: "local";
  method: string;
  expected: (url: string) => SpotCheckListing | undefined;
}) => (ctx: { paymentRequired: unknown; selectedRequirements: unknown }) => Promise<void | { abort: true; reason: string }>;

export interface SpotCheckGateOptions {
  listings: Record<string, SpotCheckListing>;
  /** for tests: how to load x402-spotcheck */
  load?: () => Promise<{ spotCheckBeforePaymentHook: HookFactory }>;
}

/** Build the gate. Never throws; every error lets the payment proceed. */
export function createSpotCheckGate(options: SpotCheckGateOptions): SpotCheckGate {
  const load = options.load ?? (() => import("x402-spotcheck") as unknown as Promise<{ spotCheckBeforePaymentHook: HookFactory }>);
  let factory: Promise<HookFactory | null> | null = null;
  const getFactory = () =>
    (factory ??= load().then(
      (m) => m.spotCheckBeforePaymentHook,
      (err) => {
        logger.warn(`x402-spotcheck not available, check skipped: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      },
    ));

  return async ({ url, method, accept, paymentRequired }) => {
    try {
      const make = await getFactory();
      if (!make) return { allowed: true };
      const hook = make({ mode: "local", method, expected: (u) => options.listings[u] });
      const verdict = await hook({
        paymentRequired: { ...paymentRequired, resource: { ...paymentRequired.resource, url } },
        selectedRequirements: accept,
      });
      if (verdict && verdict.abort) return { allowed: false, reason: verdict.reason };
      return { allowed: true };
    } catch (err) {
      logger.warn(`x402-spotcheck check failed, proceeding: ${err instanceof Error ? err.message : String(err)}`);
      return { allowed: true };
    }
  };
}

/** Gate from X402_SPOTCHECK_LISTINGS, or null when unset (feature off). */
export function spotCheckGateFromEnv(env: NodeJS.ProcessEnv = process.env): SpotCheckGate | null {
  const path = env.X402_SPOTCHECK_LISTINGS;
  if (!path) return null;
  let listings: Record<string, SpotCheckListing> = {};
  try {
    listings = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    logger.warn(`X402_SPOTCHECK_LISTINGS unreadable, check skipped: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  return createSpotCheckGate({ listings });
}
