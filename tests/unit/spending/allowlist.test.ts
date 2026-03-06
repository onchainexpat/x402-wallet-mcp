import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tempDir: string;

vi.mock("../../../src/store/paths.js", () => {
  return {
    getDataDir: () => tempDir,
    getConfigPath: () => join(tempDir, "config.json"),
    getHistoryPath: () => join(tempDir, "history.jsonl"),
    getSpendingPath: () => join(tempDir, "spending.json"),
    getEndpointsCachePath: () => join(tempDir, "endpoints-cache.json"),
  };
});

describe("merchant allowlist", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "x402-allowlist-test-"));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
    vi.resetModules();
  });

  it("allows default merchant address", async () => {
    const { checkMerchantAllowlist } = await import(
      "../../../src/spending/allowlist.js"
    );
    const result = checkMerchantAllowlist(
      "0xd8bA61a0b0974db0EC8E325C7628470526558E9B",
      "https://example.com/api",
    );
    expect(result.allowed).toBe(true);
  });

  it("blocks unknown merchant address", async () => {
    const { checkMerchantAllowlist } = await import(
      "../../../src/spending/allowlist.js"
    );
    const result = checkMerchantAllowlist(
      "0x1234567890abcdef1234567890abcdef12345678",
      "https://evil.com/drain",
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not on your allowlist");
    expect(result.reason).toContain("0x1234567890abcdef1234567890abcdef12345678");
    expect(result.reason).toContain("manage_allowlist");
  });

  it("case-insensitive address matching", async () => {
    const { checkMerchantAllowlist } = await import(
      "../../../src/spending/allowlist.js"
    );
    // Mixed case of the default merchant address
    const result = checkMerchantAllowlist(
      "0xD8BA61A0B0974DB0EC8E325C7628470526558E9B",
      "https://example.com/api",
    );
    expect(result.allowed).toBe(true);
  });

  it("allows all when disabled", async () => {
    const { loadConfig, updateConfig } = await import(
      "../../../src/store/config.js"
    );
    const config = loadConfig();
    updateConfig({ ...config, allowlist: { ...config.allowlist, enabled: false } });

    const { checkMerchantAllowlist } = await import(
      "../../../src/spending/allowlist.js"
    );
    const result = checkMerchantAllowlist(
      "0x0000000000000000000000000000000000000000",
      "https://unknown.com/api",
    );
    expect(result.allowed).toBe(true);
  });

  it("allows newly added merchant", async () => {
    const { loadConfig, updateConfig } = await import(
      "../../../src/store/config.js"
    );
    const newAddr = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const config = loadConfig();
    updateConfig({
      ...config,
      allowlist: {
        ...config.allowlist,
        merchants: [...config.allowlist.merchants, newAddr],
      },
    });

    const { checkMerchantAllowlist } = await import(
      "../../../src/spending/allowlist.js"
    );
    const result = checkMerchantAllowlist(newAddr, "https://new-merchant.com/api");
    expect(result.allowed).toBe(true);
  });

  it("default config includes our merchant", async () => {
    const { loadConfig } = await import("../../../src/store/config.js");
    const config = loadConfig();
    expect(config.allowlist.enabled).toBe(true);
    expect(config.allowlist.merchants).toContain(
      "0xd8ba61a0b0974db0ec8e325c7628470526558e9b",
    );
  });
});
