/**
 * REST client for wallet email-linking flow.
 * Talks to the same proxy service but uses the /link/ endpoints.
 */

const DEFAULT_BASE_URL = "https://x402.onchainexpat.com";

function getBaseUrl(): string {
  const proxyUrl = process.env.X402_PROXY_URL;
  if (proxyUrl) {
    // Strip /api/wallet suffix to get the base URL
    return proxyUrl.replace(/\/api\/wallet\/?$/, "");
  }
  return DEFAULT_BASE_URL;
}

export interface LinkSessionResponse {
  session_id: string;
  link_url: string;
}

export interface LinkStatusResponse {
  status: "pending" | "completed" | "expired";
  wallet_id?: string;
  address?: string;
  wallet_secret?: string;
  email?: string;
}

export async function createLinkSession(): Promise<LinkSessionResponse> {
  const res = await fetch(`${getBaseUrl()}/api/wallet/link/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`createLinkSession failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<LinkSessionResponse>;
}

export async function pollLinkStatus(sessionId: string): Promise<LinkStatusResponse> {
  const res = await fetch(
    `${getBaseUrl()}/api/wallet/link/status?session=${encodeURIComponent(sessionId)}`,
  );
  if (!res.ok) {
    throw new Error(`pollLinkStatus failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<LinkStatusResponse>;
}
