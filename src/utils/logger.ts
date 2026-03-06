/**
 * Stderr-only logger. MUST NOT touch stdout (reserved for MCP JSON-RPC).
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

function formatMessage(level: LogLevel, msg: string): string {
  const ts = new Date().toISOString();
  return `[${ts}] [x402-wallet] [${level.toUpperCase()}] ${msg}`;
}

export const logger = {
  debug(msg: string): void {
    if (shouldLog("debug")) process.stderr.write(formatMessage("debug", msg) + "\n");
  },
  info(msg: string): void {
    if (shouldLog("info")) process.stderr.write(formatMessage("info", msg) + "\n");
  },
  warn(msg: string): void {
    if (shouldLog("warn")) process.stderr.write(formatMessage("warn", msg) + "\n");
  },
  error(msg: string): void {
    if (shouldLog("error")) process.stderr.write(formatMessage("error", msg) + "\n");
  },
};
