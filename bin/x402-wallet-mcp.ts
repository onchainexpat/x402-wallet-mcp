#!/usr/bin/env node
import { main } from "../src/index.js";

main().catch((err) => {
  process.stderr.write(`[x402-wallet-mcp] Fatal error: ${err}\n`);
  process.exit(1);
});
