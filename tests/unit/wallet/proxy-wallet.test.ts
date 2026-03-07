import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
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

vi.mock("../../../src/wallet/proxy-api.js", () => ({
  proxyCreateWallet: vi.fn().mockResolvedValue({
    wallet_id: "proxy-wallet-new-456",
    address: "0xproxyabcdefabcdefabcdefabcdefabcdefabcd",
    wallet_secret: "abcd1234secret",
  }),
  proxyGetWallet: vi.fn().mockResolvedValue({
    id: "proxy-wallet-existing-123",
    address: "0xproxy1234567890abcdef1234567890abcdef1234",
    chain_type: "ethereum",
  }),
  proxySignTypedData: vi.fn().mockResolvedValue({
    signature: "0x" + "cd".repeat(65),
  }),
}));

describe("ProxyWallet", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "x402-proxy-test-"));
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
    vi.clearAllMocks();
  });

  it("creates a new wallet when no proxyWalletId in config", async () => {
    const { proxyCreateWallet } = await import("../../../src/wallet/proxy-api.js");
    const { ProxyWallet } = await import("../../../src/wallet/proxy-wallet.js");

    const wallet = await ProxyWallet.create();

    expect(proxyCreateWallet).toHaveBeenCalled();
    expect(wallet.getEvmAddress()).toBe("0xproxyabcdefabcdefabcdefabcdefabcdefabcd");
    expect(wallet.mode).toBe("proxy");
  });

  it("loads existing wallet when proxyWalletId and proxyWalletSecret are in config", async () => {
    writeFileSync(
      join(tempDir, "config.json"),
      JSON.stringify({
        version: 1,
        wallet: {
          mode: "proxy",
          proxyWalletId: "proxy-wallet-existing-123",
          proxyWalletSecret: "existing-secret",
        },
        spending: { perCallMaxUsdc: "5.00", dailyCapUsdc: "50.00" },
        endpointSources: [],
        preferences: { preferEscrow: false, preferredNetwork: "evm" },
      }),
    );

    const { proxyGetWallet, proxyCreateWallet } = await import(
      "../../../src/wallet/proxy-api.js"
    );
    const { ProxyWallet } = await import("../../../src/wallet/proxy-wallet.js");

    const wallet = await ProxyWallet.create();

    expect(proxyGetWallet).toHaveBeenCalledWith(
      "proxy-wallet-existing-123",
      "existing-secret",
    );
    expect(proxyCreateWallet).not.toHaveBeenCalled();
    expect(wallet.getEvmAddress()).toBe(
      "0xproxy1234567890abcdef1234567890abcdef1234",
    );
  });

  it("throws when existing wallet fetch fails (does not create new)", async () => {
    writeFileSync(
      join(tempDir, "config.json"),
      JSON.stringify({
        version: 1,
        wallet: {
          mode: "proxy",
          proxyWalletId: "proxy-wallet-deleted-789",
          proxyWalletSecret: "old-secret",
        },
        spending: { perCallMaxUsdc: "5.00", dailyCapUsdc: "50.00" },
        endpointSources: [],
        preferences: { preferEscrow: false, preferredNetwork: "evm" },
      }),
    );

    const proxyApi = await import("../../../src/wallet/proxy-api.js");
    vi.mocked(proxyApi.proxyGetWallet).mockRejectedValueOnce(
      new Error("Wallet not found"),
    );

    const { ProxyWallet } = await import("../../../src/wallet/proxy-wallet.js");

    await expect(ProxyWallet.create()).rejects.toThrow("Wallet not found");
    expect(proxyApi.proxyCreateWallet).not.toHaveBeenCalled();
  });

  it("ProxyWallet.load() throws when no wallet in config", async () => {
    const { ProxyWallet } = await import("../../../src/wallet/proxy-wallet.js");

    await expect(ProxyWallet.load()).rejects.toThrow("No proxy wallet found in config");
  });

  it("ProxyWallet.load() throws when API fails (does not create new)", async () => {
    writeFileSync(
      join(tempDir, "config.json"),
      JSON.stringify({
        version: 1,
        wallet: {
          mode: "proxy",
          proxyWalletId: "proxy-wallet-123",
          proxyWalletSecret: "secret-123",
        },
        spending: { perCallMaxUsdc: "5.00", dailyCapUsdc: "50.00" },
        endpointSources: [],
        preferences: { preferEscrow: false, preferredNetwork: "evm" },
      }),
    );

    const proxyApi = await import("../../../src/wallet/proxy-api.js");
    vi.mocked(proxyApi.proxyGetWallet).mockRejectedValueOnce(
      new Error("API unavailable"),
    );

    const { ProxyWallet } = await import("../../../src/wallet/proxy-wallet.js");

    await expect(ProxyWallet.load()).rejects.toThrow("API unavailable");
    expect(proxyApi.proxyCreateWallet).not.toHaveBeenCalled();
  });

  it("ProxyWallet.createNew() creates new wallet", async () => {
    const proxyApi = await import("../../../src/wallet/proxy-api.js");
    const { ProxyWallet } = await import("../../../src/wallet/proxy-wallet.js");

    const wallet = await ProxyWallet.createNew();

    expect(proxyApi.proxyCreateWallet).toHaveBeenCalled();
    expect(wallet.getEvmAddress()).toBe("0xproxyabcdefabcdefabcdefabcdefabcdefabcd");
    expect(wallet.mode).toBe("proxy");
  });

  it("getProxyCredentials() returns credentials", async () => {
    const { ProxyWallet } = await import("../../../src/wallet/proxy-wallet.js");
    const wallet = new ProxyWallet("wid-1", "secret-1", "0xaaa");

    const creds = wallet.getProxyCredentials();
    expect(creds).toEqual({ walletId: "wid-1", walletSecret: "secret-1" });
  });

  it("delegates signTypedData to proxy API", async () => {
    const { proxySignTypedData } = await import(
      "../../../src/wallet/proxy-api.js"
    );
    const { ProxyWallet } = await import("../../../src/wallet/proxy-wallet.js");

    const wallet = await ProxyWallet.create();

    const domain = { name: "USD Coin", version: "2", chainId: 8453n };
    const types = {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
      ],
    };
    const message = { from: "0xaaa", to: "0xbbb" };

    const sig = await wallet.signTypedData(
      domain,
      types,
      "TransferWithAuthorization",
      message,
    );

    expect(proxySignTypedData).toHaveBeenCalledWith(
      "proxy-wallet-new-456",
      "abcd1234secret",
      {
        domain,
        types,
        primaryType: "TransferWithAuthorization",
        message,
      },
      undefined,
    );
    expect(sig).toMatch(/^0x/);
  });

  it("describe() returns mode=proxy with recoverable=true", async () => {
    const { ProxyWallet } = await import("../../../src/wallet/proxy-wallet.js");
    const wallet = await ProxyWallet.create();
    const info = wallet.describe();

    expect(info.mode).toBe("proxy");
    expect(info.recoverable).toBe(true);
    expect(info.evmAddress).toBe("0xproxyabcdefabcdefabcdefabcdefabcdefabcd");
  });
});
