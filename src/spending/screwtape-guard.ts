/**
 * Optional external spend check via Screwtape.ai.
 *
 * Off by default. Enable with SCREWTAPE_GUARD=1. When enabled, the negotiator
 * asks Screwtape whether a payment should go out (and whether it duplicates an
 * earlier one) before anything is signed. Fails closed by default: if the
 * service cannot answer, the payment is not signed. Set
 * SCREWTAPE_FAIL_MODE=open to let payments continue in that case.
 *
 * Docs: https://screwtape.ai/docs/ · Hook package: https://github.com/screwtapeai/screwtape-x402-guard
 */

import { logger } from "../utils/logger.js";

export interface ScrewtapeCheckInput {
  url: string;
  payTo: string;
  amountAtomic: bigint;
  network: string;
  asset?: string;
}

export interface ScrewtapeCheckResult {
  allowed: boolean;
  reason?: string;
}

const DEFAULT_BASE_URL = "https://screwtape.ai";
const TIMEOUT_MS = 12_000;

export function isScrewtapeGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env.SCREWTAPE_GUARD ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function failOpen(env: NodeJS.ProcessEnv): boolean {
  return (env.SCREWTAPE_FAIL_MODE ?? "").trim().toLowerCase() === "open";
}

function invoiceId(input: ScrewtapeCheckInput): string {
  const raw = [input.url, input.payTo, String(input.amountAtomic), input.network, input.asset ?? ""].join("|");
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `pay-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function vendor(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

async function post(
  path: string,
  body: unknown,
  env: NodeJS.ProcessEnv,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const base = (env.SCREWTAPE_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = env.SCREWTAPE_API_KEY?.trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let json: Record<string, unknown> = {};
    try {
      const parsed = await response.json();
      if (parsed && typeof parsed === "object") json = parsed as Record<string, unknown>;
    } catch {
      // ignore unreadable body
    }
    return { ok: response.ok, status: response.status, json };
  } finally {
    clearTimeout(timer);
  }
}

/** Ask Screwtape whether this payment should go out. Never throws. */
export async function checkWithScrewtape(
  input: ScrewtapeCheckInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ScrewtapeCheckResult> {
  const invoice = {
    vendor: vendor(input.url),
    invoice_id: invoiceId(input),
    amount: input.amountAtomic.toString(),
    currency: "USD",
    payee: input.payTo,
    resource: input.url,
    network: input.network,
    ...(input.asset ? { asset: input.asset } : {}),
  };

  const unavailable = (reason: string): ScrewtapeCheckResult => {
    if (failOpen(env)) {
      logger.warn(`Screwtape check unavailable, continuing (fail-open): ${reason}`);
      return { allowed: true, reason };
    }
    return { allowed: false, reason: `Screwtape check unavailable: ${reason}` };
  };

  try {
    const judge = await post(
      "/v1/judge",
      {
        task: "Decide whether this agent payment should go out. Pay only on pass.",
        agent_output: JSON.stringify(invoice),
        criteria: ["The payee and amount match the payment instruction"],
      },
      env,
    );
    if (!judge.ok) return unavailable(`judge HTTP ${judge.status}`);
    const verdict = judge.json.verdict;
    if (verdict !== "pass") {
      if (verdict === "fail" || verdict === "retry") {
        return { allowed: false, reason: `Screwtape judge returned ${verdict}` };
      }
      return unavailable("judge returned no verdict");
    }

    const duplicate = await post(
      "/v1/duplicate",
      {
        task: "Check this payment instruction for duplicates before paying.",
        agent_output: JSON.stringify(invoice),
        duplicate: {
          vendor_path: "vendor",
          invoice_id_path: "invoice_id",
          amount_path: "amount",
          currency_path: "currency",
          payee_account_path: "payee",
          store: true,
        },
      },
      env,
    );
    if (!duplicate.ok) return unavailable(`duplicate HTTP ${duplicate.status}`);
    const dup = duplicate.json.duplicate as { status?: unknown } | undefined;
    const status = dup?.status;
    if (status === "duplicate" || status === "possible_duplicate" || status === "replay") {
      return { allowed: false, reason: `Screwtape duplicate check returned ${status}` };
    }
    if (status !== "unique") return unavailable(`duplicate status ${String(status)}`);
    return { allowed: true };
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : "network error");
  }
}
