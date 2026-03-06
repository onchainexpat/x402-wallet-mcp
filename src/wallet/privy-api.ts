/**
 * Direct REST client for Privy wallet API.
 * Replaces @privy-io/server-auth SDK with 3 fetch calls.
 */

const PRIVY_BASE = "https://api.privy.io/v1";

export interface PrivyWalletResponse {
  id: string;
  address: string;
  chain_type: string;
}

export interface PrivySignResponse {
  data: { signature: string };
}

interface PrivyAuth {
  authHeader: string;
  appId: string;
}

export function getPrivyAuth(): PrivyAuth {
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error("Set PRIVY_APP_ID and PRIVY_APP_SECRET");
  }

  const credentials = Buffer.from(`${appId}:${appSecret}`).toString("base64");
  return {
    authHeader: `Basic ${credentials}`,
    appId,
  };
}

function headers(auth: PrivyAuth): Record<string, string> {
  return {
    Authorization: auth.authHeader,
    "privy-app-id": auth.appId,
    "Content-Type": "application/json",
  };
}

export async function createWallet(chainType: string): Promise<PrivyWalletResponse> {
  const auth = getPrivyAuth();
  const res = await fetch(`${PRIVY_BASE}/wallets`, {
    method: "POST",
    headers: headers(auth),
    body: JSON.stringify({ chain_type: chainType }),
  });
  if (!res.ok) {
    throw new Error(`Privy createWallet failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<PrivyWalletResponse>;
}

export async function getWallet(id: string): Promise<PrivyWalletResponse> {
  const auth = getPrivyAuth();
  const res = await fetch(`${PRIVY_BASE}/wallets/${id}`, {
    headers: headers(auth),
  });
  if (!res.ok) {
    throw new Error(`Privy getWallet failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<PrivyWalletResponse>;
}

export async function signTypedData(
  walletId: string,
  typedData: unknown,
): Promise<PrivySignResponse> {
  const auth = getPrivyAuth();
  const res = await fetch(`${PRIVY_BASE}/wallets/${walletId}/rpc`, {
    method: "POST",
    headers: headers(auth),
    body: JSON.stringify({
      method: "eth_signTypedData_v4",
      params: { typed_data: typedData },
    }),
  });
  if (!res.ok) {
    throw new Error(`Privy signTypedData failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<PrivySignResponse>;
}
