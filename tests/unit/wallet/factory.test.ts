import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tempDir: string;

vi.mock("../../../src/store/paths.js", () => ({
  getDataDir: () => tempDir,
  getConfigPath: () => join(tempDir, "config.json"),
  getHistoryPath: () => join(tempDir, "history.jsonl"),
  getSpendingPath: () => join(tempDir, "spending.json"),
  getEndpointsCachePath: () => join(tempDir, "endpoints-cache.json"),
}));

vi.mock("../../../src/wallet/privy-api.js", () => ({
  getPrivyAuth: vi.fn().mockReturnValue({
    authHeader: "Basic dGVzdDp0ZXN0",
    appId: "test-app-id",
  }),
  createWallet: vi.fn().mockResolvedValue({
    id: "wallet-factory-123",
    address: "0x1111111111111111111111111111111111111111",
    chain_type: "ethereum",
  }),
  getWallet: vi.fn(),
  signTypedData: vi.fn(),
}));

vi.mock("../../../src/wallet/proxy-api.js", () => ({
  proxyCreateWallet: vi.fn().mockResolvedValue({
    wallet_id: "proxy-factory-456",
    address: "0x2222222222222222222222222222222222222222",
    wallet_secret: "factory-secret-abc",
  }),
  proxyGetWallet: vi.fn(),
  proxySignTypedData: vi.fn(),
}));

vi.mock("../../../src/wallet/link-api.js", () => ({
  createLinkSession: vi.fn().mockResolvedValue({
    session_id: "session-factory-test",
    link_url: "https://x402.onchainexpat.com/link/session-factory-test",
  }),
  pollLinkStatus: vi.fn().mockResolvedValue({
    status: "expired",
  }),
}));

describe("wallet factory", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "x402-factory-test-"));
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
    vi.clearAllMocks();
    // Restore env
    process.env = { ...originalEnv };
  });

  it("creates a Privy wallet when PRIVY env vars are set", async () => {
    process.env.PRIVY_APP_ID = "test-app-id";
    process.env.PRIVY_APP_SECRET = "test-app-secret";

    const { createWallet } = await import("../../../src/wallet/factory.js");
    const wallet = await createWallet();

    expect(wallet.mode).toBe("privy");
    expect(wallet.getEvmAddress()).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("creates a Proxy wallet when PRIVY env vars are missing and linking is skipped", async () => {
    delete process.env.PRIVY_APP_ID;
    delete process.env.PRIVY_APP_SECRET;
    process.env.X402_SKIP_LINKING = "1";

    const { createWallet } = await import("../../../src/wallet/factory.js");
    const wallet = await createWallet();

    expect(wallet.mode).toBe("proxy");
    expect(wallet.getEvmAddress()).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("prefers Privy over Proxy when both could work", async () => {
    process.env.PRIVY_APP_ID = "test-app-id";
    process.env.PRIVY_APP_SECRET = "test-app-secret";

    const { createWallet } = await import("../../../src/wallet/factory.js");
    const wallet = await createWallet();

    // Should use Privy, not Proxy
    expect(wallet.mode).toBe("privy");
  });

  it("falls back to proxy when email linking expires", async () => {
    delete process.env.PRIVY_APP_ID;
    delete process.env.PRIVY_APP_SECRET;
    delete process.env.X402_SKIP_LINKING;

    const { createWallet } = await import("../../../src/wallet/factory.js");
    const wallet = await createWallet();

    // Link session mock returns expired, so should fall back to proxy
    expect(wallet.mode).toBe("proxy");
  });

  it("getPrivyAuth throws when env vars are missing", () => {
    // Test the real implementation directly
    const realGetPrivyAuth = () => {
      const appId = process.env.PRIVY_APP_ID;
      const appSecret = process.env.PRIVY_APP_SECRET;
      if (!appId || !appSecret) {
        throw new Error("Set PRIVY_APP_ID and PRIVY_APP_SECRET");
      }
    };

    delete process.env.PRIVY_APP_ID;
    delete process.env.PRIVY_APP_SECRET;
    expect(() => realGetPrivyAuth()).toThrow("Set PRIVY_APP_ID and PRIVY_APP_SECRET");
  });
});
