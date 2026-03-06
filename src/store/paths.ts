import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";

const DATA_DIR_NAME = ".x402-wallet";

export function getDataDir(): string {
  const dir = join(homedir(), DATA_DIR_NAME);
  if (!existsSync(dir)) {
    mkdirSync(dir, { mode: 0o700, recursive: true });
  }
  return dir;
}

export function getConfigPath(): string {
  return join(getDataDir(), "config.json");
}

export function getHistoryPath(): string {
  return join(getDataDir(), "history.jsonl");
}

export function getSpendingPath(): string {
  return join(getDataDir(), "spending.json");
}

export function getEndpointsCachePath(): string {
  return join(getDataDir(), "endpoints-cache.json");
}
