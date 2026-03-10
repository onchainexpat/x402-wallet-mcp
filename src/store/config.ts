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
  autoApproveThresholdUsdc: string;
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
  spending: { perCallMaxUsdc: "5.00", dailyCapUsdc: "50.00", autoApproveThresholdUsdc: "0.05" },
  endpointSources: [
    "https://x402.onchainexpat.com",
    "https://padelmaps.org",
    "https://stableenrich.dev",
    "https://stablestudio.dev",
    "https://x402.twit.sh",
  ],
  customEndpoints: [],
  preferences: { preferEscrow: false, preferredNetwork: "evm" },
  allowlist: {
    enabled: true,
    merchants: [
      "0xd8ba61a0b0974db0ec8e325c7628470526558e9b", // onchainexpat
      "0x325bdf6f7efab24a2210c48c1b64cab2eae1d430", // stableenrich
      "0xfbd7b7ed48146ad9beff956212c77ce056815ad0", // stablestudio
      "0x9dba414637c611a16bea6f0796bfcbcbdc410df8", // twit.sh
    ],
  },
};

function migrateConfig(config: AppConfig): AppConfig {
  let changed = false;

  if ((config.version ?? 1) < 2) {
    // v2: Add AgentCash partner ecosystem
    const partnerSources = [
      "https://stableenrich.dev",
      "https://stablestudio.dev",
      "https://x402.twit.sh",
    ];
    for (const src of partnerSources) {
      if (!config.endpointSources.includes(src)) {
        config.endpointSources.push(src);
      }
    }

    const partnerMerchants = [
      "0x325bdf6f7efab24a2210c48c1b64cab2eae1d430",
      "0xfbd7b7ed48146ad9beff956212c77ce056815ad0",
      "0x9dba414637c611a16bea6f0796bfcbcbdc410df8",
    ];
    for (const m of partnerMerchants) {
      if (!config.allowlist.merchants.includes(m)) {
        config.allowlist.merchants.push(m);
      }
    }

    config.version = 2;
    changed = true;
  }

  if (changed) saveConfig(config);
  return config;
}

export function loadConfig(): AppConfig {
  const path = getConfigPath();
  if (!existsSync(path)) {
    saveConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return migrateConfig({
      ...DEFAULT_CONFIG,
      ...parsed,
      spending: { ...DEFAULT_CONFIG.spending, ...parsed.spending },
    });
  } catch {
    // Config corrupted — try restoring from backup
    const bakPath = getConfigBackupPath();
    if (existsSync(bakPath)) {
      try {
        const bakRaw = readFileSync(bakPath, "utf-8");
        const bakParsed = JSON.parse(bakRaw) as Partial<AppConfig>;
        console.warn("[x402-wallet] Config corrupted, restored from backup");
        return migrateConfig({
          ...DEFAULT_CONFIG,
          ...bakParsed,
          spending: { ...DEFAULT_CONFIG.spending, ...bakParsed.spending },
        });
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
