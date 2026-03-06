import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";

// Generate a real Ed25519 key pair for tests
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pubRaw = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
const privRaw = privateKey.export({ type: "pkcs8", format: "der" }).subarray(-32);
const testSecret = Buffer.concat([privRaw, pubRaw]).toString("base64");
const testKeyId = "organizations/test-org/apiKeys/test-key";

describe("onramp", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("returns null when CDP env vars are not set", async () => {
    delete process.env.CDP_API_KEY_ID;
    delete process.env.CDP_API_KEY_SECRET;

    const { generateOnrampUrl } = await import("../../../src/utils/onramp.js");
    const result = await generateOnrampUrl("0x1234567890abcdef1234567890abcdef12345678");
    expect(result).toBeNull();
  });

  it("generates a valid onramp URL when token API succeeds", async () => {
    process.env.CDP_API_KEY_ID = testKeyId;
    process.env.CDP_API_KEY_SECRET = testSecret;

    const mockToken = "test-session-token-abc123";
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: mockToken }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { generateOnrampUrl } = await import("../../../src/utils/onramp.js");
    const url = await generateOnrampUrl("0xABCD", 50);

    expect(url).not.toBeNull();
    expect(url).toContain("pay.coinbase.com/buy/select-asset");
    expect(url).toContain(`sessionToken=${mockToken}`);
    expect(url).toContain("defaultNetwork=base");
    expect(url).toContain("defaultAsset=USDC");
    expect(url).toContain("presetFiatAmount=50");

    // Verify the fetch call
    expect(mockFetch).toHaveBeenCalledOnce();
    const [callUrl, callOpts] = mockFetch.mock.calls[0];
    expect(callUrl).toBe("https://api.developer.coinbase.com/onramp/v1/token");
    expect(callOpts.method).toBe("POST");
    expect(callOpts.headers.Authorization).toMatch(/^Bearer /);
    expect(callOpts.headers["Content-Type"]).toBe("application/json");

    // Verify request body
    const body = JSON.parse(callOpts.body);
    expect(body.addresses).toEqual([{ address: "0xABCD", blockchains: ["base"] }]);
    expect(body.assets).toEqual(["USDC"]);
  });

  it("uses default amount of 25 when not specified", async () => {
    process.env.CDP_API_KEY_ID = testKeyId;
    process.env.CDP_API_KEY_SECRET = testSecret;

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: "tok" }),
    }));

    const { generateOnrampUrl } = await import("../../../src/utils/onramp.js");
    const url = await generateOnrampUrl("0xABCD");

    expect(url).toContain("presetFiatAmount=25");
  });

  it("returns null when token API returns error", async () => {
    process.env.CDP_API_KEY_ID = testKeyId;
    process.env.CDP_API_KEY_SECRET = testSecret;

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    }));

    const { generateOnrampUrl } = await import("../../../src/utils/onramp.js");
    const result = await generateOnrampUrl("0xABCD");
    expect(result).toBeNull();
  });

  it("returns null when token API returns no token", async () => {
    process.env.CDP_API_KEY_ID = testKeyId;
    process.env.CDP_API_KEY_SECRET = testSecret;

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }));

    const { generateOnrampUrl } = await import("../../../src/utils/onramp.js");
    const result = await generateOnrampUrl("0xABCD");
    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    process.env.CDP_API_KEY_ID = testKeyId;
    process.env.CDP_API_KEY_SECRET = testSecret;

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    const { generateOnrampUrl } = await import("../../../src/utils/onramp.js");
    const result = await generateOnrampUrl("0xABCD");
    expect(result).toBeNull();
  });

  it("JWT has valid 3-segment base64url structure", async () => {
    process.env.CDP_API_KEY_ID = testKeyId;
    process.env.CDP_API_KEY_SECRET = testSecret;

    let capturedJwt: string | null = null;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, opts: { headers: { Authorization: string } }) => {
      const auth = opts.headers.Authorization;
      capturedJwt = auth.replace("Bearer ", "");
      return { ok: true, json: async () => ({ token: "tok" }) };
    }));

    const { generateOnrampUrl } = await import("../../../src/utils/onramp.js");
    await generateOnrampUrl("0xABCD");

    expect(capturedJwt).not.toBeNull();
    const parts = capturedJwt!.split(".");
    expect(parts).toHaveLength(3);

    // Decode and verify header
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    expect(header.alg).toBe("EdDSA");
    expect(header.typ).toBe("JWT");
    expect(header.kid).toBe(testKeyId);
    expect(header.nonce).toBeDefined();

    // Decode and verify payload
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    expect(payload.sub).toBe(testKeyId);
    expect(payload.iss).toBe("cdp");
    expect(payload.aud).toEqual(["cdp_service"]);
    expect(payload.uris).toEqual(["POST api.developer.coinbase.com/onramp/v1/token"]);
    expect(payload.exp).toBeGreaterThan(payload.nbf);
  });
});
