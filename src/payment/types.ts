/** An accept entry from a 402 response */
export interface AcceptEntry {
  scheme: "exact" | "escrow";
  network: string;
  amount: string;
  maxAmountRequired?: string;
  payTo: string;
  asset: string;
  maxTimeoutSeconds?: number;
  extra?: {
    name?: string;
    version?: string;
    // Escrow-specific fields
    operatorAddress?: string;
    escrowAddress?: string;
    tokenCollector?: string;
    minFeeBps?: number;
    maxFeeBps?: number;
    [key: string]: unknown;
  };
}

/** The payment requirements returned in a 402 response */
export interface PaymentRequired {
  x402Version: number;
  accepts: AcceptEntry[];
  error?: string;
  resource?: {
    url?: string;
    method?: string;
  };
}

/** Authorization data included in the payment payload */
export interface Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

/** PaymentInfo for escrow payments */
export interface PaymentInfo {
  operator: string;
  receiver: string;
  token: string;
  maxAmount: string;
  preApprovalExpiry: number;
  authorizationExpiry: number;
  refundExpiry: number;
  minFeeBps: number;
  maxFeeBps: number;
  feeReceiver: string;
  salt: string;
}

/** The full payment payload (before base64 encoding) */
export interface ExactPaymentPayload {
  x402Version: 1;
  scheme: "exact";
  network: string;
  payload: {
    signature: string;
    authorization: Authorization;
  };
}

export interface EscrowPaymentPayload {
  x402Version: 2;
  scheme: "escrow";
  network: string;
  payload: {
    authorization: Authorization;
    signature: string;
    paymentInfo: PaymentInfo;
  };
  resource: { method: string };
  accepted: AcceptEntry;
}

export type PaymentPayload = ExactPaymentPayload | EscrowPaymentPayload;

/** Result of a negotiated payment call */
export interface PaymentResult {
  success: boolean;
  status: number;
  data: unknown;
  amountPaid?: bigint;
  network?: string;
  scheme?: "exact" | "escrow";
  error?: string;
}
