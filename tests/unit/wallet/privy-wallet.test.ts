import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
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
    id: "wallet-new-456",
    address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    chain_type: "ethereum",
  }),
  getWallet: vi.fn().mockResolvedValue({
    id: "wallet-existing-123",
    address: "0x1234567890abcdef1234567890abcdef12345678",
    chain_type: "ethereum",
  }),
  signTypedData: vi.fn().mockResolvedValue({
    data: { signature: "0x" + "ab".repeat(65) },
  }),
}));

describe("PrivyWallet", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "x402-privy-test-"));
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
    vi.clearAllMocks();
  });

  it("creates a new wallet when no privyWalletId in config", async () => {
    const { createWallet } = await import("../../../src/wallet/privy-api.js");
    const { PrivyWallet } = await import("../../../src/wallet/privy-wallet.js");

    const wallet = await PrivyWallet.create();

    expect(createWallet).toHaveBeenCalledWith("ethereum");
    expect(wallet.getEvmAddress()).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
    expect(wallet.mode).toBe("privy");
  });

  it("loads existing wallet when privyWalletId is in config", async () => {
    writeFileSync(
      join(tempDir, "config.json"),
      JSON.stringify({
        version: 1,
        wallet: { mode: "privy", privyWalletId: "wallet-existing-123" },
        spending: { perCallMaxUsdc: "5.00", dailyCapUsdc: "50.00" },
        endpointSources: [],
        preferences: { preferEscrow: false, preferredNetwork: "evm" },
      }),
    );

    const { getWallet, createWallet } = await import("../../../src/wallet/privy-api.js");
    const { PrivyWallet } = await import("../../../src/wallet/privy-wallet.js");

    const wallet = await PrivyWallet.create();

    expect(getWallet).toHaveBeenCalledWith("wallet-existing-123");
    expect(createWallet).not.toHaveBeenCalled();
    expect(wallet.getEvmAddress()).toBe("0x1234567890abcdef1234567890abcdef12345678");
  });

  it("falls back to creating new wallet if existing wallet fetch fails", async () => {
    writeFileSync(
      join(tempDir, "config.json"),
      JSON.stringify({
        version: 1,
        wallet: { mode: "privy", privyWalletId: "wallet-deleted-789" },
        spending: { perCallMaxUsdc: "5.00", dailyCapUsdc: "50.00" },
        endpointSources: [],
        preferences: { preferEscrow: false, preferredNetwork: "evm" },
      }),
    );

    const privyApi = await import("../../../src/wallet/privy-api.js");
    vi.mocked(privyApi.getWallet).mockRejectedValueOnce(new Error("Wallet not found"));

    const { PrivyWallet } = await import("../../../src/wallet/privy-wallet.js");
    const wallet = await PrivyWallet.create();

    expect(privyApi.getWallet).toHaveBeenCalledWith("wallet-deleted-789");
    expect(privyApi.createWallet).toHaveBeenCalledWith("ethereum");
    expect(wallet.getEvmAddress()).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
  });

  it("persists new wallet ID to config after creation", async () => {
    const { PrivyWallet } = await import("../../../src/wallet/privy-wallet.js");
    await PrivyWallet.create();

    const { loadConfig } = await import("../../../src/store/config.js");
    const config = loadConfig();
    expect(config.wallet.privyWalletId).toBe("wallet-new-456");
    expect(config.wallet.mode).toBe("privy");
  });

  it("delegates signTypedData to Privy API", async () => {
    const { signTypedData } = await import("../../../src/wallet/privy-api.js");
    const { PrivyWallet } = await import("../../../src/wallet/privy-wallet.js");

    const wallet = await PrivyWallet.create();

    const domain = { name: "USD Coin", version: "2", chainId: 8453n };
    const types = {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
      ],
    };
    const message = { from: "0xaaa", to: "0xbbb" };

    const sig = await wallet.signTypedData(domain, types, "TransferWithAuthorization", message);

    expect(signTypedData).toHaveBeenCalledWith("wallet-new-456", {
      domain,
      types,
      primaryType: "TransferWithAuthorization",
      message,
    });
    expect(sig).toMatch(/^0x/);
  });

  it("propagates Privy signing errors", async () => {
    const privyApi = await import("../../../src/wallet/privy-api.js");
    vi.mocked(privyApi.signTypedData).mockRejectedValueOnce(new Error("HSM unavailable"));

    const { PrivyWallet } = await import("../../../src/wallet/privy-wallet.js");
    const wallet = await PrivyWallet.create();

    await expect(
      wallet.signTypedData({}, {}, "Test", {}),
    ).rejects.toThrow("HSM unavailable");
  });

  it("describe() reports privy mode with recoverable=true", async () => {
    const { PrivyWallet } = await import("../../../src/wallet/privy-wallet.js");
    const wallet = await PrivyWallet.create();
    const info = wallet.describe();

    expect(info.mode).toBe("privy");
    expect(info.recoverable).toBe(true);
    expect(info.evmAddress).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
  });
});
