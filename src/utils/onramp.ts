/**
 * Coinbase Onramp URL generator.
 *
 * Generates a pre-filled Coinbase Onramp URL that lets users buy USDC on Base
 * with a debit card or Apple Pay — no existing crypto needed.
 *
 * Requires env vars:
 *   CDP_API_KEY_ID     — e.g. "organizations/{org}/apiKeys/{key}"
 *   CDP_API_KEY_SECRET — base64-encoded Ed25519 private key
 *
 * Returns null if env vars are not set (graceful degradation).
 */

import { randomBytes, sign, createPrivateKey } from "node:crypto";
import { logger } from "./logger.js";

const ONRAMP_TOKEN_URL = "https://api.developer.coinbase.com/onramp/v1/token";
const ONRAMP_PAY_BASE = "https://pay.coinbase.com/buy/select-asset";

/**
 * Build an EdDSA JWT for Coinbase Developer Platform API auth.
 */
function generateCdpJwt(method: string, path: string): string | null {
  const keyId = process.env.CDP_API_KEY_ID;
  const keySecret = process.env.CDP_API_KEY_SECRET;
  if (!keyId || !keySecret) return null;

  const now = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(16).toString("hex");

  const header = {
    alg: "EdDSA",
    typ: "JWT",
    kid: keyId,
    nonce,
  };

  const payload = {
    sub: keyId,
    iss: "cdp",
    aud: ["cdp_service"],
    nbf: now,
    exp: now + 120,
    uris: [`${method} api.developer.coinbase.com${path}`],
  };

  const b64url = (obj: unknown): string =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64url");

  const signingInput = `${b64url(header)}.${b64url(payload)}`;

  // Decode the base64 secret — it's a 64-byte Ed25519 key (seed + public).
  // Node crypto JWK needs both d (seed, 32 bytes) and x (public key, 32 bytes).
  const secretBytes = Buffer.from(keySecret, "base64");
  const seed = secretBytes.subarray(0, 32);
  const pub = secretBytes.subarray(32, 64);

  const privateKey = createPrivateKey({
    key: {
      kty: "OKP",
      crv: "Ed25519",
      d: seed.toString("base64url"),
      x: pub.toString("base64url"),
    },
    format: "jwk",
  });

  const signature = sign(null, Buffer.from(signingInput), privateKey);

  return `${signingInput}.${signature.toString("base64url")}`;
}

/**
 * Generate a Coinbase Onramp URL for buying USDC on Base.
 *
 * @param address  — EVM wallet address to receive USDC
 * @param amountUsd — optional pre-filled USD amount (default: 25)
 * @returns URL string, or null if CDP env vars are not configured
 */
export async function generateOnrampUrl(
  address: string,
  amountUsd: number = 25,
): Promise<string | null> {
  const jwt = generateCdpJwt("POST", "/onramp/v1/token");
  if (!jwt) {
    logger.debug("CDP env vars not set — skipping onramp URL generation");
    return null;
  }

  try {
    const response = await fetch(ONRAMP_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        addresses: [{ address, blockchains: ["base"] }],
        assets: ["USDC"],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error(`Coinbase Onramp token API returned ${response.status}: ${body}`);
      return null;
    }

    const data = (await response.json()) as { token?: string };
    const token = data.token;
    if (!token) {
      logger.error("Coinbase Onramp token API returned no token");
      return null;
    }

    const params = new URLSearchParams({
      sessionToken: token,
      defaultNetwork: "base",
      defaultAsset: "USDC",
      fiatCurrency: "USD",
      presetFiatAmount: String(amountUsd),
    });

    return `${ONRAMP_PAY_BASE}?${params.toString()}`;
  } catch (err) {
    logger.error(
      `Failed to generate onramp URL: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
