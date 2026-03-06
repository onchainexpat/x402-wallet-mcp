import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock the paths module to use temp directory
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

describe("spending tracker", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "x402-spending-test-"));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
    vi.resetModules();
  });

  it("allows payments within limits", async () => {
    const { checkSpendingLimit } = await import(
      "../../../src/spending/tracker.js"
    );
    const result = checkSpendingLimit(1000n); // 0.001 USDC
    expect(result.allowed).toBe(true);
  });

  it("rejects payments exceeding per-call max", async () => {
    const { checkSpendingLimit } = await import(
      "../../../src/spending/tracker.js"
    );
    // Default per-call max is $5.00 = 5000000 atomic
    const result = checkSpendingLimit(6_000_000n); // $6.00
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("per-call max");
  });

  it("tracks daily spending", async () => {
    const { addSpending, loadSpending } = await import(
      "../../../src/spending/store.js"
    );

    addSpending(1_000_000n); // $1.00
    addSpending(500_000n); // $0.50

    const record = loadSpending();
    expect(BigInt(record.totalAtomic)).toBe(1_500_000n);
    expect(record.callCount).toBe(2);
  });
});
