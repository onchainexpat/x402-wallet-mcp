#!/usr/bin/env node
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };

function handleCliMetadata(argv = process.argv.slice(2)): boolean {
  const flags = new Set(argv);
  if (flags.has("--version") || flags.has("-v")) {
    console.log(packageJson.version);
    return true;
  }
  if (flags.has("--help") || flags.has("-h")) {
    console.log(`Usage: x402-wallet-mcp [options]

Options:
  -v, --version  Print the package version.
  -h, --help     Print this help message.

Run without options to start the x402 Wallet MCP server over stdio.`);
    return true;
  }
  return false;
}

if (handleCliMetadata()) {
  process.exit(0);
}

import { main } from "../src/index.js";

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\n[x402-wallet-mcp] Startup failed:\n  ${msg.split("\n").join("\n  ")}\n\n`);
  process.exit(1);
});
