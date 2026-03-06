import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createWallet } from "./wallet/factory.js";
import { createServer } from "./server.js";
import { loadConfig } from "./store/config.js";
import { getDataDir } from "./store/paths.js";
import { logger } from "./utils/logger.js";

export async function main(): Promise<void> {
  // Ensure data directory exists
  getDataDir();

  // Load or create config
  loadConfig();

  // Create wallet
  const wallet = await createWallet();
  const info = wallet.describe();

  logger.info(`Wallet ready: ${info.mode} mode`);
  logger.info(`EVM address: ${info.evmAddress}`);
  if (info.mode === "linked") {
    logger.info(`Wallet linked to ${info.linkedEmail || "email"} — recoverable via email verification`);
  } else if (info.mode === "proxy") {
    logger.info("Using hosted proxy — set PRIVY_APP_ID and PRIVY_APP_SECRET for direct Privy access");
  }
  logger.info(`Send USDC on Base to ${info.evmAddress} to fund your wallet`);

  // Create and start MCP server
  const server = createServer(wallet);
  const transport = new StdioServerTransport();

  logger.info("Starting MCP server on stdio...");
  await server.connect(transport);
}

// Re-export for library usage
export { createWallet } from "./wallet/factory.js";
export { createServer } from "./server.js";
export type { WalletProvider, WalletInfo } from "./wallet/types.js";
export type { PaymentResult, AcceptEntry, PaymentRequired } from "./payment/types.js";
