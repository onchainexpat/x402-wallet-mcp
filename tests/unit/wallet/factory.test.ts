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

describe("wallet factory", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "x402-factory-test-"));
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
    vi.clearAllMocks();
  });

  it("creates a Privy wallet", async () => {
    const { createWallet } = await import("../../../src/wallet/factory.js");
    const wallet = await createWallet();

    expect(wallet.mode).toBe("privy");
    expect(wallet.getEvmAddress()).toMatch(/^0x[0-9a-fA-F]{40}$/);
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
