#!/usr/bin/env node
import { main } from "../src/index.js";

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\n[x402-wallet-mcp] Startup failed:\n  ${msg.split("\n").join("\n  ")}\n\n`);
  process.exit(1);
});
