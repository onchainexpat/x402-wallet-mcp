import { randomUUID } from "node:crypto";

const DEFAULT_URL = "https://payguard-production-abfe.up.railway.app";

export interface X402AcceptEntry {
  scheme: "exact" | "escrow";
  network: string;
  amount: string;
  maxAmountRequired?: string;
  payTo: string;
  asset: string;
}

export interface PreSignIntent {
  url: string;
  method: string;
  accept: X402AcceptEntry;
}

export interface GateResult {
  allowed: boolean;
  decision: "ALLOW" | "BLOCK" | "REQUIRE_APPROVAL" | "ERROR";
  reasons: string[];
  receiptId?: string;
}

export interface PayGuardGateOptions {
  token: string;
  agentId?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  intentId?: () => string;
}

function fail(reason: string): GateResult {
  return { allowed: false, decision: "ERROR", reasons: [reason] };
}

export function createPayGuardPreSignGate(options: PayGuardGateOptions) {
  const {
    token,
    agentId = "x402-wallet-mcp",
    baseUrl = DEFAULT_URL,
    timeoutMs = 3000,
    fetchImpl = globalThis.fetch,
    intentId = randomUUID,
  } = options;
  if (!token) throw new Error("PayGuard client token is required");
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");

  return async function authorizeBeforeSigning(input: PreSignIntent): Promise<GateResult> {
    const rawAmount = input.accept.maxAmountRequired ?? input.accept.amount;
    let amount: bigint;
    try {
      amount = BigInt(rawAmount);
    } catch {
      return fail("invalid_x402_amount");
    }
    if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) {
      return fail("unsupported_x402_amount");
    }

    const requestId = `wallet-${intentId()}`;
    const body = {
      intent_id: requestId,
      agent_id: agentId,
      rail: "x402",
      amount_minor: Number(amount),
      currency: "USDC",
      payee: input.accept.payTo,
      endpoint: input.url,
      x402: {
        amount: rawAmount,
        payTo: input.accept.payTo,
        network: input.accept.network,
        asset: input.accept.asset,
        resource: { url: input.url },
      },
      context: {
        source_trust: "unknown",
        payment_requested_by_untrusted_content: false,
        integration: "x402-wallet-mcp",
        http_method: input.method.toUpperCase(),
        scheme: input.accept.scheme,
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/check`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) return fail(`payguard_http_${response.status}`);
      const receipt = await response.json() as Record<string, unknown>;
      const decision = receipt.decision;
      if (!new Set(["ALLOW", "BLOCK", "REQUIRE_APPROVAL"]).has(String(decision))) {
        return fail("malformed_payguard_receipt");
      }
      if (
        receipt.intent_id !== requestId ||
        receipt.amount_minor !== Number(amount) ||
        receipt.currency !== "USDC" ||
        receipt.rail !== "x402" ||
        receipt.network !== input.accept.network ||
        receipt.asset !== input.accept.asset.toLowerCase() ||
        typeof receipt.receipt_id !== "string" ||
        typeof receipt.request_hash !== "string" ||
        typeof receipt.expires_at !== "string" ||
        Date.parse(receipt.expires_at) <= Date.now()
      ) {
        return fail("mismatched_payguard_receipt");
      }
      return {
        allowed: decision === "ALLOW",
        decision: decision as GateResult["decision"],
        reasons: Array.isArray(receipt.reasons) ? receipt.reasons.map(String) : [],
        receiptId: receipt.receipt_id,
      };
    } catch {
      return fail("payguard_unavailable");
    } finally {
      clearTimeout(timer);
    }
  };
}
