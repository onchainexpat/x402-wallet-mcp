import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
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

describe("config store", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "x402-config-test-"));
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
    vi.restoreAllMocks();
  });

  it("creates default config when none exists", async () => {
    const { loadConfig } = await import("../../../src/store/config.js");
    const config = loadConfig();

    expect(config.version).toBe(1);
    expect(config.wallet.mode).toBe("privy");
    expect(config.spending.perCallMaxUsdc).toBe("5.00");
    expect(config.spending.dailyCapUsdc).toBe("50.00");
    expect(config.endpointSources).toContain("https://x402.onchainexpat.com");
    expect(config.preferences.preferEscrow).toBe(false);
    // Should have written the file
    expect(existsSync(join(tempDir, "config.json"))).toBe(true);
  });

  it("reads existing config file", async () => {
    writeFileSync(
      join(tempDir, "config.json"),
      JSON.stringify({
        version: 1,
        wallet: { mode: "privy" },
        spending: { perCallMaxUsdc: "10.00", dailyCapUsdc: "100.00" },
        endpointSources: ["https://custom.example.com"],
        preferences: { preferEscrow: true, preferredNetwork: "evm" },
      }),
    );

    const { loadConfig } = await import("../../../src/store/config.js");
    const config = loadConfig();

    expect(config.wallet.mode).toBe("privy");
    expect(config.spending.perCallMaxUsdc).toBe("10.00");
    expect(config.endpointSources).toEqual(["https://custom.example.com"]);
    expect(config.preferences.preferEscrow).toBe(true);
  });

  it("saveConfig writes to disk", async () => {
    const { saveConfig, loadConfig } = await import("../../../src/store/config.js");

    saveConfig({
      version: 1,
      wallet: { mode: "privy", privyWalletId: "abc123" },
      spending: { perCallMaxUsdc: "20.00", dailyCapUsdc: "200.00" },
      endpointSources: [],
      customEndpoints: [],
      preferences: { preferEscrow: false, preferredNetwork: "evm" },
      allowlist: { enabled: true, merchants: [] },
    });

    const raw = readFileSync(join(tempDir, "config.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.wallet.privyWalletId).toBe("abc123");

    const reloaded = loadConfig();
    expect(reloaded.wallet.privyWalletId).toBe("abc123");
  });

  it("updateConfig merges with existing", async () => {
    const { loadConfig, updateConfig } = await import("../../../src/store/config.js");

    loadConfig(); // Create default
    const updated = updateConfig({
      spending: { perCallMaxUsdc: "15.00", dailyCapUsdc: "150.00" },
    });

    expect(updated.spending.perCallMaxUsdc).toBe("15.00");
    expect(updated.wallet.mode).toBe("privy"); // Preserved from default
    expect(updated.endpointSources).toContain("https://x402.onchainexpat.com"); // Preserved
  });

  it("backup file is created before overwrite", async () => {
    const { saveConfig } = await import("../../../src/store/config.js");

    // First save — no backup yet (no existing file)
    saveConfig({
      version: 1,
      wallet: { mode: "privy", privyWalletId: "first-wallet" },
      spending: { perCallMaxUsdc: "5.00", dailyCapUsdc: "50.00" },
      endpointSources: [],
      customEndpoints: [],
      preferences: { preferEscrow: false, preferredNetwork: "evm" },
      allowlist: { enabled: true, merchants: [] },
    });

    // Second save — should backup the first
    saveConfig({
      version: 1,
      wallet: { mode: "privy", privyWalletId: "second-wallet" },
      spending: { perCallMaxUsdc: "5.00", dailyCapUsdc: "50.00" },
      endpointSources: [],
      customEndpoints: [],
      preferences: { preferEscrow: false, preferredNetwork: "evm" },
      allowlist: { enabled: true, merchants: [] },
    });

    // Backup should exist with the first wallet
    const bakPath = join(tempDir, "config.json.bak");
    expect(existsSync(bakPath)).toBe(true);
    const bakContent = JSON.parse(readFileSync(bakPath, "utf-8"));
    expect(bakContent.wallet.privyWalletId).toBe("first-wallet");

    // Current config should have the second wallet
    const currentContent = JSON.parse(readFileSync(join(tempDir, "config.json"), "utf-8"));
    expect(currentContent.wallet.privyWalletId).toBe("second-wallet");
  });

  it("corrupted config restored from backup", async () => {
    // Write a valid backup
    writeFileSync(
      join(tempDir, "config.json.bak"),
      JSON.stringify({
        version: 1,
        wallet: { mode: "proxy", proxyWalletId: "backup-wallet" },
        spending: { perCallMaxUsdc: "5.00", dailyCapUsdc: "50.00" },
      }),
    );

    // Write corrupted main config
    writeFileSync(join(tempDir, "config.json"), "not valid json{{{");

    const { loadConfig } = await import("../../../src/store/config.js");
    const config = loadConfig();

    expect(config.wallet.proxyWalletId).toBe("backup-wallet");
    expect(config.wallet.mode).toBe("proxy");
  });

  it("both config and backup corrupted returns defaults", async () => {
    writeFileSync(join(tempDir, "config.json"), "corrupt!!!");
    writeFileSync(join(tempDir, "config.json.bak"), "also corrupt!!!");

    const { loadConfig } = await import("../../../src/store/config.js");
    const config = loadConfig();

    // Should return defaults
    expect(config.version).toBe(1);
    expect(config.wallet.mode).toBe("privy");
  });

  it("handles corrupted config file gracefully", async () => {
    writeFileSync(join(tempDir, "config.json"), "not valid json{{{");

    const { loadConfig } = await import("../../../src/store/config.js");
    const config = loadConfig();

    // Should return defaults (no backup exists)
    expect(config.version).toBe(1);
    expect(config.wallet.mode).toBe("privy");
  });
});
