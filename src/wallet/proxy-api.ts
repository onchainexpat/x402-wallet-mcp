/**
 * REST client for the x402 wallet proxy service.
 * Mirrors privy-api.ts but targets the hosted proxy instead of Privy directly.
 */

const DEFAULT_PROXY_URL = "https://x402.onchainexpat.com/api/wallet";

function getProxyUrl(): string {
  return process.env.X402_PROXY_URL || DEFAULT_PROXY_URL;
}

export interface ProxyWalletResponse {
  wallet_id: string;
  address: string;
  wallet_secret: string;
}

export interface ProxyGetWalletResponse {
  id: string;
  address: string;
  chain_type: string;
}

export interface ProxySignResponse {
  signature: string;
}

export async function proxyCreateWallet(): Promise<ProxyWalletResponse> {
  const res = await fetch(`${getProxyUrl()}/provision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Proxy createWallet failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<ProxyWalletResponse>;
}

export async function proxyGetWallet(
  walletId: string,
  secret: string,
): Promise<ProxyGetWalletResponse> {
  const res = await fetch(`${getProxyUrl()}/${walletId}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!res.ok) {
    throw new Error(`Proxy getWallet failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<ProxyGetWalletResponse>;
}

export async function proxySignTypedData(
  walletId: string,
  secret: string,
  typedData: unknown,
  allowlistToken?: string,
): Promise<ProxySignResponse> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  };
  if (allowlistToken) {
    headers["X-Allowlist-Token"] = allowlistToken;
  }
  const res = await fetch(`${getProxyUrl()}/${walletId}/sign`, {
    method: "POST",
    headers,
    body: JSON.stringify({ typed_data: typedData }, (_k, v) =>
      typeof v === "bigint"
        ? v <= BigInt(Number.MAX_SAFE_INTEGER)
          ? Number(v)
          : `0x${v.toString(16)}`
        : v,
    ),
  });
  if (!res.ok) {
    throw new Error(`Proxy signTypedData failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<ProxySignResponse>;
}
