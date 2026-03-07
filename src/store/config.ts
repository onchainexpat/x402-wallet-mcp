import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { getConfigPath, getConfigBackupPath } from "./paths.js";

export interface WalletConfig {
  mode: "privy" | "proxy" | "linked";
  privyWalletId?: string | null;
  proxyWalletId?: string | null;
  proxyWalletSecret?: string | null;
  linkedEmail?: string | null;
  walletType?: "server" | "embedded" | null;
  allowlistToken?: string | null;
}

export interface SpendingConfig {
  perCallMaxUsdc: string;
  dailyCapUsdc: string;
}

export interface CustomEndpoint {
  url: string;
  description?: string;
}

export interface AllowlistConfig {
  enabled: boolean;
  merchants: string[]; // lowercased 0x addresses
}

export interface AppConfig {
  version: number;
  wallet: WalletConfig;
  spending: SpendingConfig;
  endpointSources: string[];
  customEndpoints: CustomEndpoint[];
  preferences: {
    preferEscrow: boolean;
    preferredNetwork: "evm";
  };
  allowlist: AllowlistConfig;
}

const DEFAULT_CONFIG: AppConfig = {
  version: 1,
  wallet: { mode: "privy", privyWalletId: null },
  spending: { perCallMaxUsdc: "5.00", dailyCapUsdc: "50.00" },
  endpointSources: [
    "https://x402.onchainexpat.com",
    "https://padelmaps.org",
  ],
  customEndpoints: [],
  preferences: { preferEscrow: false, preferredNetwork: "evm" },
  allowlist: {
    enabled: true,
    merchants: ["0xd8ba61a0b0974db0ec8e325c7628470526558e9b"],
  },
};

export function loadConfig(): AppConfig {
  const path = getConfigPath();
  if (!existsSync(path)) {
    saveConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    // Config corrupted — try restoring from backup
    const bakPath = getConfigBackupPath();
    if (existsSync(bakPath)) {
      try {
        const bakRaw = readFileSync(bakPath, "utf-8");
        const bakParsed = JSON.parse(bakRaw) as Partial<AppConfig>;
        console.warn("[x402-wallet] Config corrupted, restored from backup");
        return { ...DEFAULT_CONFIG, ...bakParsed };
      } catch {
        // Backup also corrupted
      }
    }
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: AppConfig): void {
  const path = getConfigPath();
  // Backup existing config before overwriting
  if (existsSync(path)) {
    try {
      copyFileSync(path, getConfigBackupPath());
    } catch {
      // Best-effort backup — don't block the save
    }
  }
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
}

export function updateConfig(updates: Partial<AppConfig>): AppConfig {
  const config = loadConfig();
  const merged = { ...config, ...updates };
  saveConfig(merged);
  return merged;
}
