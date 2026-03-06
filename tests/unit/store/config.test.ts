import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
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

  it("handles corrupted config file gracefully", async () => {
    writeFileSync(join(tempDir, "config.json"), "not valid json{{{");

    const { loadConfig } = await import("../../../src/store/config.js");
    const config = loadConfig();

    // Should return defaults
    expect(config.version).toBe(1);
    expect(config.wallet.mode).toBe("privy");
  });
});
