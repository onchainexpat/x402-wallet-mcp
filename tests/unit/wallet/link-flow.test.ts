import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tempDir: string;

vi.mock("../../../src/store/paths.js", () => ({
  getDataDir: () => tempDir,
  getConfigPath: () => join(tempDir, "config.json"),
  getConfigBackupPath: () => join(tempDir, "config.json.bak"),
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
    id: "wallet-privy-123",
    address: "0x1111111111111111111111111111111111111111",
    chain_type: "ethereum",
  }),
  getWallet: vi.fn(),
  signTypedData: vi.fn(),
}));

vi.mock("../../../src/wallet/proxy-api.js", () => ({
  proxyCreateWallet: vi.fn().mockResolvedValue({
    wallet_id: "proxy-anon-456",
    address: "0x2222222222222222222222222222222222222222",
    wallet_secret: "anon-secret-abc",
  }),
  proxyGetWallet: vi.fn().mockResolvedValue({
    id: "proxy-linked-789",
    address: "0x3333333333333333333333333333333333333333",
    chain_type: "ethereum",
  }),
  proxySignTypedData: vi.fn(),
}));

describe("email linking flow", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "x402-link-test-"));
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  it("new wallet falls back to anonymous proxy (no auto-linking)", async () => {
    delete process.env.PRIVY_APP_ID;
    delete process.env.PRIVY_APP_SECRET;

    const { createWallet } = await import("../../../src/wallet/factory.js");
    const wallet = await createWallet();

    // Factory no longer does auto-linking — falls back to anonymous proxy
    expect(wallet.mode).toBe("proxy");
    expect(wallet.getEvmAddress()).toBe("0x2222222222222222222222222222222222222222");
  });

  it("skips linking when X402_SKIP_LINKING is set and falls back to proxy", async () => {
    delete process.env.PRIVY_APP_ID;
    delete process.env.PRIVY_APP_SECRET;
    process.env.X402_SKIP_LINKING = "1";

    const { createWallet } = await import("../../../src/wallet/factory.js");
    const wallet = await createWallet();

    expect(wallet.mode).toBe("proxy");
  });

  it("loads existing linked wallet from config", async () => {
    delete process.env.PRIVY_APP_ID;
    delete process.env.PRIVY_APP_SECRET;

    writeFileSync(
      join(tempDir, "config.json"),
      JSON.stringify({
        version: 1,
        wallet: {
          mode: "linked",
          proxyWalletId: "proxy-linked-789",
          proxyWalletSecret: "linked-secret",
          linkedEmail: "saved@example.com",
        },
        spending: { perCallMaxUsdc: "5.00", dailyCapUsdc: "50.00" },
        endpointSources: [],
        customEndpoints: [],
        preferences: { preferEscrow: false, preferredNetwork: "evm" },
        allowlist: { enabled: true, merchants: [] },
      }),
    );

    const proxyApi = await import("../../../src/wallet/proxy-api.js");
    const { createWallet } = await import("../../../src/wallet/factory.js");
    const wallet = await createWallet();

    expect(wallet.mode).toBe("linked");
    expect(proxyApi.proxyGetWallet).toHaveBeenCalledWith("proxy-linked-789", "linked-secret");
    expect(wallet.describe().linkedEmail).toBe("saved@example.com");
  });

  it("falls back to anonymous proxy when no existing wallet in config", async () => {
    delete process.env.PRIVY_APP_ID;
    delete process.env.PRIVY_APP_SECRET;

    const { createWallet } = await import("../../../src/wallet/factory.js");
    const wallet = await createWallet();

    // No existing wallet → creates anonymous proxy
    expect(wallet.mode).toBe("proxy");
  });

  it("falls back to anonymous proxy when linking session creation fails (no existing wallet)", async () => {
    delete process.env.PRIVY_APP_ID;
    delete process.env.PRIVY_APP_SECRET;

    const { createWallet } = await import("../../../src/wallet/factory.js");
    const wallet = await createWallet();

    // No existing wallet in config → falls back to proxy
    expect(wallet.mode).toBe("proxy");
  });

  it("throws when existing linked wallet API fails (does not fall through to proxy)", async () => {
    delete process.env.PRIVY_APP_ID;
    delete process.env.PRIVY_APP_SECRET;
    process.env.X402_SKIP_LINKING = "1";

    writeFileSync(
      join(tempDir, "config.json"),
      JSON.stringify({
        version: 1,
        wallet: {
          mode: "linked",
          proxyWalletId: "linked-fail-123",
          proxyWalletSecret: "linked-secret",
          linkedEmail: "fail@example.com",
        },
        spending: { perCallMaxUsdc: "5.00", dailyCapUsdc: "50.00" },
        endpointSources: [],
        customEndpoints: [],
        preferences: { preferEscrow: false, preferredNetwork: "evm" },
        allowlist: { enabled: true, merchants: [] },
      }),
    );

    const proxyApi = await import("../../../src/wallet/proxy-api.js");
    vi.mocked(proxyApi.proxyGetWallet).mockRejectedValue(
      new Error("Service down"),
    );

    const { createWallet } = await import("../../../src/wallet/factory.js");
    await expect(createWallet()).rejects.toThrow("Could not load linked wallet");
    expect(proxyApi.proxyCreateWallet).not.toHaveBeenCalled();
  });

  it("ProxyWallet describe() includes linkedEmail in linked mode", async () => {
    const { ProxyWallet } = await import("../../../src/wallet/proxy-wallet.js");
    const wallet = new ProxyWallet(
      "wid-1",
      "secret-1",
      "0x5555555555555555555555555555555555555555",
      "linked",
      "user@example.com",
    );

    const info = wallet.describe();
    expect(info.mode).toBe("linked");
    expect(info.linkedEmail).toBe("user@example.com");
    expect(info.recoverable).toBe(true);
  });
});
