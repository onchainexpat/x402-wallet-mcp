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

describe("spending limits", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "x402-limits-test-"));
    delete process.env.X402_PER_CALL_MAX;
    delete process.env.X402_DAILY_CAP;
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("allows small payments within default limits", async () => {
    const { checkSpendingLimit } = await import(
      "../../../src/spending/tracker.js"
    );
    const result = checkSpendingLimit(1000n); // $0.001
    expect(result.allowed).toBe(true);
  });

  it("rejects payments exceeding per-call max ($5 default)", async () => {
    const { checkSpendingLimit } = await import(
      "../../../src/spending/tracker.js"
    );
    const result = checkSpendingLimit(6_000_000n); // $6.00 > $5.00
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("per-call max");
  });

  it("allows payment exactly at per-call max", async () => {
    const { checkSpendingLimit } = await import(
      "../../../src/spending/tracker.js"
    );
    const result = checkSpendingLimit(5_000_000n); // $5.00 = $5.00
    expect(result.allowed).toBe(true);
  });

  it("rejects when daily cap would be exceeded", async () => {
    const { checkSpendingLimit, recordSpending } = await import(
      "../../../src/spending/tracker.js"
    );

    // Spend $49 first
    recordSpending(49_000_000n);

    // Now try to spend $2 more (would exceed $50 cap)
    const result = checkSpendingLimit(2_000_000n);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("daily cap");
  });

  it("allows payment that exactly hits daily cap", async () => {
    const { checkSpendingLimit, recordSpending } = await import(
      "../../../src/spending/tracker.js"
    );

    recordSpending(49_000_000n);

    // $1 more to exactly hit $50 cap
    const result = checkSpendingLimit(1_000_000n);
    expect(result.allowed).toBe(true);
  });

  it("respects env var overrides for per-call max", async () => {
    process.env.X402_PER_CALL_MAX = "1.00";

    const { checkSpendingLimit } = await import(
      "../../../src/spending/tracker.js"
    );

    expect(checkSpendingLimit(500_000n).allowed).toBe(true); // $0.50 < $1.00
    expect(checkSpendingLimit(1_500_000n).allowed).toBe(false); // $1.50 > $1.00
  });

  it("respects env var overrides for daily cap", async () => {
    process.env.X402_DAILY_CAP = "10.00";

    const { checkSpendingLimit, recordSpending } = await import(
      "../../../src/spending/tracker.js"
    );

    recordSpending(9_000_000n); // $9.00
    expect(checkSpendingLimit(2_000_000n).allowed).toBe(false); // $2 more > $10 cap
    expect(checkSpendingLimit(1_000_000n).allowed).toBe(true); // $1 more = $10 cap
  });

  it("getSpendingSummary returns current state", async () => {
    const { recordSpending, getSpendingSummary } = await import(
      "../../../src/spending/tracker.js"
    );

    recordSpending(1_000_000n);
    recordSpending(500_000n);

    const summary = getSpendingSummary();
    expect(BigInt(summary.todaySpent)).toBe(1_500_000n);
    expect(summary.todayCount).toBe(2);
    expect(summary.dailyCap).toBe("50.00");
    expect(summary.perCallMax).toBe("5.00");
  });
});

describe("spending store", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "x402-store-test-"));
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
    vi.restoreAllMocks();
  });

  it("starts fresh with zero spending", async () => {
    const { loadSpending } = await import("../../../src/spending/store.js");
    const record = loadSpending();
    expect(BigInt(record.totalAtomic)).toBe(0n);
    expect(record.callCount).toBe(0);
  });

  it("accumulates spending across multiple calls", async () => {
    const { addSpending, loadSpending } = await import(
      "../../../src/spending/store.js"
    );

    addSpending(1_000_000n);
    addSpending(2_000_000n);
    addSpending(500_000n);

    const record = loadSpending();
    expect(BigInt(record.totalAtomic)).toBe(3_500_000n);
    expect(record.callCount).toBe(3);
  });

  it("resets when date changes", async () => {
    const { addSpending, loadSpending } = await import(
      "../../../src/spending/store.js"
    );

    addSpending(5_000_000n);

    // Simulate a date change by writing yesterday's date
    writeFileSync(
      join(tempDir, "spending.json"),
      JSON.stringify({
        date: "2020-01-01",
        totalAtomic: "5000000",
        callCount: 1,
      }),
    );

    const record = loadSpending();
    expect(BigInt(record.totalAtomic)).toBe(0n); // Reset
    expect(record.callCount).toBe(0);
  });

  it("handles corrupted spending file gracefully", async () => {
    writeFileSync(join(tempDir, "spending.json"), "corrupted{{{");

    const { loadSpending } = await import("../../../src/spending/store.js");
    const record = loadSpending();
    expect(BigInt(record.totalAtomic)).toBe(0n);
    expect(record.callCount).toBe(0);
  });
});
