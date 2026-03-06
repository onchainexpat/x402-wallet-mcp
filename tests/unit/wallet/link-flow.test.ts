import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
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

vi.mock("../../../src/wallet/link-api.js", () => ({
  createLinkSession: vi.fn().mockResolvedValue({
    session_id: "session-test-123",
    link_url: "https://x402.onchainexpat.com/link/session-test-123",
  }),
  pollLinkStatus: vi.fn().mockResolvedValue({
    status: "completed",
    wallet_id: "linked-wallet-001",
    address: "0x4444444444444444444444444444444444444444",
    wallet_secret: "linked-secret-xyz",
    email: "test@example.com",
  }),
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

  it("new wallet triggers email linking and saves linked config", async () => {
    delete process.env.PRIVY_APP_ID;
    delete process.env.PRIVY_APP_SECRET;
    delete process.env.X402_SKIP_LINKING;

    const { createWallet } = await import("../../../src/wallet/factory.js");
    const wallet = await createWallet();

    expect(wallet.mode).toBe("linked");
    expect(wallet.getEvmAddress()).toBe("0x4444444444444444444444444444444444444444");

    const info = wallet.describe();
    expect(info.linkedEmail).toBe("test@example.com");

    // Verify config was saved
    const config = JSON.parse(readFileSync(join(tempDir, "config.json"), "utf-8"));
    expect(config.wallet.mode).toBe("linked");
    expect(config.wallet.linkedEmail).toBe("test@example.com");
    expect(config.wallet.proxyWalletId).toBe("linked-wallet-001");
  });

  it("skips linking when X402_SKIP_LINKING is set and falls back to proxy", async () => {
    delete process.env.PRIVY_APP_ID;
    delete process.env.PRIVY_APP_SECRET;
    process.env.X402_SKIP_LINKING = "1";

    const linkApi = await import("../../../src/wallet/link-api.js");
    const { createWallet } = await import("../../../src/wallet/factory.js");
    const wallet = await createWallet();

    expect(wallet.mode).toBe("proxy");
    expect(linkApi.createLinkSession).not.toHaveBeenCalled();
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

  it("falls back to anonymous proxy when linking times out", async () => {
    delete process.env.PRIVY_APP_ID;
    delete process.env.PRIVY_APP_SECRET;
    delete process.env.X402_SKIP_LINKING;

    const linkApi = await import("../../../src/wallet/link-api.js");
    vi.mocked(linkApi.pollLinkStatus).mockResolvedValue({
      status: "expired",
    });

    const { createWallet } = await import("../../../src/wallet/factory.js");
    const wallet = await createWallet();

    expect(wallet.mode).toBe("proxy");
    expect(linkApi.createLinkSession).toHaveBeenCalled();
  });

  it("falls back to anonymous proxy when linking session creation fails", async () => {
    delete process.env.PRIVY_APP_ID;
    delete process.env.PRIVY_APP_SECRET;
    delete process.env.X402_SKIP_LINKING;

    const linkApi = await import("../../../src/wallet/link-api.js");
    vi.mocked(linkApi.createLinkSession).mockRejectedValueOnce(
      new Error("Network error"),
    );

    const { createWallet } = await import("../../../src/wallet/factory.js");
    const wallet = await createWallet();

    expect(wallet.mode).toBe("proxy");
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
