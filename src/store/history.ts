import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { getHistoryPath } from "./paths.js";
import type { TransactionEntry } from "../payment/negotiator.js";

/** Append a transaction to the JSONL history file */
export function appendTransaction(entry: TransactionEntry): void {
  const line = JSON.stringify(entry) + "\n";
  appendFileSync(getHistoryPath(), line, { mode: 0o600 });
}

/** Read recent transactions from the history file */
export function readTransactions(limit: number = 20): TransactionEntry[] {
  const path = getHistoryPath();
  if (!existsSync(path)) return [];

  try {
    const lines = readFileSync(path, "utf-8")
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);

    const entries: TransactionEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip malformed lines
      }
    }

    // Return most recent first
    return entries.reverse().slice(0, limit);
  } catch {
    return [];
  }
}
