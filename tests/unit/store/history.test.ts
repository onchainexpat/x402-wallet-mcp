import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TransactionEntry } from "../../../src/payment/negotiator.js";

let tempDir: string;

vi.mock("../../../src/store/paths.js", () => ({
  getDataDir: () => tempDir,
  getConfigPath: () => join(tempDir, "config.json"),
  getHistoryPath: () => join(tempDir, "history.jsonl"),
  getSpendingPath: () => join(tempDir, "spending.json"),
  getEndpointsCachePath: () => join(tempDir, "endpoints-cache.json"),
}));

describe("history store", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "x402-history-test-"));
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
    vi.restoreAllMocks();
  });

  it("returns empty array when no history file exists", async () => {
    const { readTransactions } = await import("../../../src/store/history.js");
    expect(readTransactions()).toEqual([]);
  });

  it("appends transactions as JSONL lines", async () => {
    const { appendTransaction } = await import("../../../src/store/history.js");

    const entry: TransactionEntry = {
      timestamp: "2026-03-05T00:00:00.000Z",
      url: "https://example.com/api/test",
      method: "POST",
      scheme: "exact",
      network: "eip155:8453",
      amount: "2000",
      status: "success",
    };

    appendTransaction(entry);
    appendTransaction({ ...entry, amount: "3000" });

    const raw = readFileSync(join(tempDir, "history.jsonl"), "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).amount).toBe("2000");
    expect(JSON.parse(lines[1]).amount).toBe("3000");
  });

  it("reads transactions in reverse chronological order", async () => {
    const { appendTransaction, readTransactions } = await import(
      "../../../src/store/history.js"
    );

    appendTransaction({
      timestamp: "2026-03-01T00:00:00Z",
      url: "https://example.com/first",
      method: "POST",
      scheme: "exact",
      network: "eip155:8453",
      amount: "1000",
      status: "success",
    });

    appendTransaction({
      timestamp: "2026-03-05T00:00:00Z",
      url: "https://example.com/second",
      method: "POST",
      scheme: "exact",
      network: "eip155:8453",
      amount: "2000",
      status: "success",
    });

    const txs = readTransactions();
    expect(txs).toHaveLength(2);
    expect(txs[0].url).toContain("second"); // Most recent first
    expect(txs[1].url).toContain("first");
  });

  it("respects the limit parameter", async () => {
    const { appendTransaction, readTransactions } = await import(
      "../../../src/store/history.js"
    );

    for (let i = 0; i < 10; i++) {
      appendTransaction({
        timestamp: new Date().toISOString(),
        url: `https://example.com/tx${i}`,
        method: "POST",
        scheme: "exact",
        network: "eip155:8453",
        amount: String(i * 1000),
        status: "success",
      });
    }

    expect(readTransactions(3)).toHaveLength(3);
    expect(readTransactions(5)).toHaveLength(5);
    expect(readTransactions(100)).toHaveLength(10);
  });

  it("skips malformed JSONL lines gracefully", async () => {
    const { readTransactions } = await import("../../../src/store/history.js");

    // Write a file with some bad lines
    writeFileSync(
      join(tempDir, "history.jsonl"),
      '{"url":"good1","timestamp":"t","method":"POST","scheme":"exact","network":"eip155:8453","amount":"1000","status":"success"}\n' +
        "not json at all\n" +
        '{"url":"good2","timestamp":"t","method":"POST","scheme":"exact","network":"eip155:8453","amount":"2000","status":"success"}\n',
    );

    const txs = readTransactions();
    expect(txs).toHaveLength(2);
  });

  it("includes failed transaction entries", async () => {
    const { appendTransaction, readTransactions } = await import(
      "../../../src/store/history.js"
    );

    appendTransaction({
      timestamp: new Date().toISOString(),
      url: "https://example.com/api/fail",
      method: "POST",
      scheme: "exact",
      network: "eip155:8453",
      amount: "5000",
      status: "failed",
      error: "Payment rejected by server",
    });

    const txs = readTransactions();
    expect(txs).toHaveLength(1);
    expect(txs[0].status).toBe("failed");
    expect(txs[0].error).toBe("Payment rejected by server");
  });
});
