/**
 * REST client for wallet email-linking flow.
 * Talks to the same proxy service but uses the /link/ endpoints.
 *
 * Stateless: uses JWT session_token instead of session_id.
 * verify returns wallet_secret directly — no polling needed.
 */

const DEFAULT_BASE_URL = "https://x402.onchainexpat.com";

function getBaseUrl(): string {
  const proxyUrl = process.env.X402_PROXY_URL;
  if (proxyUrl) {
    return proxyUrl.replace(/\/api\/wallet\/?$/, "");
  }
  return DEFAULT_BASE_URL;
}

export interface LinkSessionResponse {
  session_token: string;
  link_url: string;
}

export interface RecoveryResponse {
  session_token: string;
  email: string;
  message: string;
}

export interface SendOtpResponse {
  ok: boolean;
  message: string;
  session_token: string;
}

export interface VerifyOtpResponse {
  ok: boolean;
  wallet_id: string;
  address: string;
  email: string;
  wallet_secret: string;
  wallet_type?: string;
  old_wallet_id?: string;
}

export async function createLinkSession(
  existingWallet?: { walletId: string; walletSecret: string },
): Promise<LinkSessionResponse> {
  const body: Record<string, string> = {};
  if (existingWallet) {
    body.wallet_id = existingWallet.walletId;
    body.wallet_secret = existingWallet.walletSecret;
  }
  const res = await fetch(`${getBaseUrl()}/api/wallet/link/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`createLinkSession failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<LinkSessionResponse>;
}

export async function initiateRecovery(email: string): Promise<RecoveryResponse> {
  const res = await fetch(`${getBaseUrl()}/api/wallet/link/recover`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    throw new Error(`initiateRecovery failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<RecoveryResponse>;
}

export async function sendOtp(
  sessionToken: string,
  email: string,
): Promise<SendOtpResponse> {
  const res = await fetch(`${getBaseUrl()}/api/wallet/link/send-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_token: sessionToken, email }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`sendOtp failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<SendOtpResponse>;
}

export async function verifyOtp(
  sessionToken: string,
  email: string,
  code: string,
): Promise<VerifyOtpResponse> {
  const res = await fetch(`${getBaseUrl()}/api/wallet/link/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_token: sessionToken, email, code }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`verifyOtp failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<VerifyOtpResponse>;
}
