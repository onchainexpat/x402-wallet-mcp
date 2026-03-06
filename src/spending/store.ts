import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { getSpendingPath } from "../store/paths.js";

export interface SpendingRecord {
  date: string; // YYYY-MM-DD in UTC
  totalAtomic: string; // bigint as string
  callCount: number;
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export function loadSpending(): SpendingRecord {
  const path = getSpendingPath();
  if (!existsSync(path)) {
    return { date: todayUTC(), totalAtomic: "0", callCount: 0 };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as SpendingRecord;
    // Reset if day changed
    if (raw.date !== todayUTC()) {
      return { date: todayUTC(), totalAtomic: "0", callCount: 0 };
    }
    return raw;
  } catch {
    return { date: todayUTC(), totalAtomic: "0", callCount: 0 };
  }
}

export function saveSpending(record: SpendingRecord): void {
  writeFileSync(getSpendingPath(), JSON.stringify(record, null, 2) + "\n", {
    mode: 0o600,
  });
}

export function addSpending(amountAtomic: bigint): SpendingRecord {
  const record = loadSpending();
  const current = BigInt(record.totalAtomic);
  record.totalAtomic = String(current + amountAtomic);
  record.callCount += 1;
  record.date = todayUTC();
  saveSpending(record);
  return record;
}
