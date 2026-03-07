/**
 * Payment negotiator — orchestrates the 402 → sign → retry flow.
 */

import type { WalletProvider } from "../wallet/types.js";
import type { AcceptEntry, PaymentRequired, PaymentResult } from "./types.js";
import { signExactPayment } from "./evm-exact.js";
import { signEscrowPayment } from "./evm-escrow.js";
import { fetchWithRetry } from "../utils/http.js";
import { checkMerchantAllowlist } from "../spending/allowlist.js";
import { logger } from "../utils/logger.js";

export interface NegotiatorOptions {
  wallet: WalletProvider;
  checkSpendingLimit: (amountAtomic: bigint) => { allowed: boolean; reason?: string };
  recordTransaction: (entry: TransactionEntry) => void;
  preferEscrow?: boolean;
}

export interface TransactionEntry {
  timestamp: string;
  url: string;
  method: string;
  scheme: "exact" | "escrow";
  network: string;
  amount: string;
  status: "success" | "failed";
  error?: string;
}

function pickAcceptEntry(
  accepts: AcceptEntry[],
  preferEscrow: boolean,
): AcceptEntry | null {
  if (accepts.length === 0) return null;

  // Filter to supported schemes
  const evmExact = accepts.filter(
    (a) => a.scheme === "exact" && a.network.includes("eip155"),
  );
  const evmEscrow = accepts.filter(
    (a) => a.scheme === "escrow" && a.network.includes("eip155"),
  );

  if (preferEscrow && evmEscrow.length > 0) return evmEscrow[0];
  if (evmExact.length > 0) return evmExact[0];
  if (evmEscrow.length > 0) return evmEscrow[0];

  // Fallback to first entry
  return accepts[0];
}

/**
 * Make a paid API call. Handles 402 negotiation automatically.
 *
 * Flow:
 * 1. POST url (no X-PAYMENT) → expect 402
 * 2. Parse accepts[] → pick best entry
 * 3. Check spending limits → reject if over
 * 4. Sign payment → get X-PAYMENT header
 * 5. POST url (with X-PAYMENT) → expect 200
 * 6. Record transaction + update spend tracker
 */
export async function makePaymentCall(
  url: string,
  options: NegotiatorOptions & {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
    preferEscrow?: boolean;
  },
): Promise<PaymentResult> {
  const {
    wallet,
    checkSpendingLimit,
    recordTransaction,
    method = "POST",
    body,
    headers = {},
    preferEscrow = false,
  } = options;

  // Step 1: Initial request to get 402
  logger.info(`Requesting ${method} ${url}...`);

  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...headers,
  };

  const initialResponse = await fetchWithRetry(url, {
    method,
    headers: requestHeaders,
    body,
    retries: 0, // Don't retry the initial request
  });

  // If not 402, return the response as-is
  if (initialResponse.status !== 402) {
    const text = await initialResponse.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return {
      success: initialResponse.ok,
      status: initialResponse.status,
      data,
    };
  }

  // Step 2: Parse 402 response
  let paymentRequired: PaymentRequired;

  // Try PAYMENT-REQUIRED header first (base64-encoded)
  const paymentHeader = initialResponse.headers.get("payment-required");
  if (paymentHeader) {
    try {
      paymentRequired = JSON.parse(atob(paymentHeader));
    } catch {
      // Fall back to response body
      paymentRequired = await initialResponse.json();
    }
  } else {
    paymentRequired = await initialResponse.json();
  }

  // Normalize v2 paymentOptions to v1 accepts format
  const raw = paymentRequired as unknown as Record<string, unknown>;
  if (!paymentRequired.accepts && Array.isArray(raw.paymentOptions)) {
    paymentRequired.accepts = (raw.paymentOptions as Record<string, unknown>[]).map(
      (opt) => ({
        scheme: ((opt.scheme as string) ?? "exact") as "exact" | "escrow",
        network: opt.network as string,
        amount: (opt.priceAtomic as string) ?? (opt.amount as string) ?? "0",
        maxAmountRequired: opt.maxAmountRequired as string | undefined,
        payTo: opt.payTo as string,
        asset: opt.asset as string,
        maxTimeoutSeconds: opt.maxTimeoutSeconds as number | undefined,
        extra: opt.extra as AcceptEntry["extra"],
      }),
    );
  }

  const accepts = paymentRequired.accepts;
  if (!accepts || accepts.length === 0) {
    return {
      success: false,
      status: 402,
      data: paymentRequired,
      error: "Server returned 402 but no payment options",
    };
  }

  // Step 3: Pick best accept entry
  const accept = pickAcceptEntry(accepts, preferEscrow);
  if (!accept) {
    return {
      success: false,
      status: 402,
      data: paymentRequired,
      error: "No supported payment scheme in accepts",
    };
  }

  const amountAtomic = BigInt(accept.maxAmountRequired ?? accept.amount);
  const scheme = accept.scheme;
  const network = accept.network;

  // Step 3b: Check merchant allowlist
  const allowlistCheck = checkMerchantAllowlist(accept.payTo, url);
  if (!allowlistCheck.allowed) {
    return {
      success: false,
      status: 402,
      data: {
        error: "merchant_not_allowed",
        merchantAddress: accept.payTo,
        url,
        price: String(amountAtomic),
        detail: allowlistCheck.reason,
      },
      error: allowlistCheck.reason,
      amountPaid: 0n,
      network,
      scheme,
    };
  }

  // Step 4: Check spending limits
  const limitCheck = checkSpendingLimit(amountAtomic);
  if (!limitCheck.allowed) {
    return {
      success: false,
      status: 402,
      data: { error: "spending_limit", detail: limitCheck.reason },
      error: limitCheck.reason,
      amountPaid: 0n,
      network,
      scheme,
    };
  }

  // Step 5: Sign payment
  let xPayment: string;
  try {
    if (scheme === "escrow") {
      xPayment = await signEscrowPayment(wallet, accept);
    } else {
      xPayment = await signExactPayment(wallet, accept);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      status: 402,
      data: { error: "signing_failed", detail: errMsg },
      error: `Payment signing failed: ${errMsg}`,
    };
  }

  // Step 6: Retry with payment
  logger.info(`Sending payment (${scheme}, ${network}, ${amountAtomic} atomic USDC)...`);

  const paidResponse = await fetchWithRetry(url, {
    method,
    headers: {
      ...requestHeaders,
      "X-PAYMENT": xPayment,
    },
    body,
    retries: 0, // Don't retry after signing — authorization might be consumed
  });

  const responseText = await paidResponse.text();
  let responseData: unknown;
  try {
    responseData = JSON.parse(responseText);
  } catch {
    responseData = responseText;
  }

  // Step 7: Check for double-402
  if (paidResponse.status === 402) {
    const entry: TransactionEntry = {
      timestamp: new Date().toISOString(),
      url,
      method,
      scheme,
      network,
      amount: String(amountAtomic),
      status: "failed",
      error: "Payment rejected by server",
    };
    recordTransaction(entry);

    return {
      success: false,
      status: 402,
      data: responseData,
      error: `Payment rejected by server: ${JSON.stringify(responseData)}`,
      amountPaid: 0n,
      network,
      scheme,
    };
  }

  // Step 8: Record success
  const entry: TransactionEntry = {
    timestamp: new Date().toISOString(),
    url,
    method,
    scheme,
    network,
    amount: String(amountAtomic),
    status: paidResponse.ok ? "success" : "failed",
    error: paidResponse.ok ? undefined : `HTTP ${paidResponse.status}`,
  };
  recordTransaction(entry);

  return {
    success: paidResponse.ok,
    status: paidResponse.status,
    data: responseData,
    amountPaid: paidResponse.ok ? amountAtomic : 0n,
    network,
    scheme,
  };
}

/**
 * Probe an endpoint's pricing without paying.
 * Makes a request without X-PAYMENT to get the 402 response.
 */
export async function probeEndpoint(
  url: string,
  method: string = "POST",
): Promise<PaymentRequired | null> {
  try {
    const response = await fetchWithRetry(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "POST" ? "{}" : undefined,
      retries: 0,
    });

    if (response.status !== 402) {
      return null; // Not a paid endpoint
    }

    const paymentHeader = response.headers.get("payment-required");
    if (paymentHeader) {
      try {
        return JSON.parse(atob(paymentHeader));
      } catch {
        // Fall through
      }
    }
    return await response.json();
  } catch {
    return null;
  }
}
