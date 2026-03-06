<p align="center">
  <h1 align="center">x402-wallet-mcp</h1>
  <p align="center">
    A self-custodial USDC wallet that lets AI agents pay for APIs autonomously.
  </p>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/x402-wallet-mcp"><img src="https://img.shields.io/npm/v/x402-wallet-mcp.svg" alt="npm version"></a>
  <a href="https://github.com/onchainexpat/x402-wallet-mcp/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/x402-wallet-mcp.svg" alt="license"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/x402-wallet-mcp.svg" alt="node version"></a>
</p>

---

Give [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Cursor](https://cursor.sh), or any [MCP](https://modelcontextprotocol.io/) client its own wallet. It discovers x402 endpoints, signs USDC payments on Base, and handles the full HTTP 402 negotiation — so your AI agent can call paid APIs without human intervention.

```
You: "Get me the top Hacker News stories from the x402 API"
Claude: Using call_endpoint to pay $0.002 USDC...
       ✓ Payment signed (EIP-3009 TransferWithAuthorization)
       ✓ Got 10 stories from https://x402.onchainexpat.com/api/x402-tools/hackernews/top
```

## Why This Exists

AI agents need to spend money. Today that means hardcoded API keys, credit cards on file, or manual approval for every request. The [x402 protocol](https://github.com/coinbase/x402) fixes this: servers return HTTP 402 with a price, clients sign a USDC payment, and the request goes through. No API keys. No subscriptions. Pay per call.

This project is the missing piece: an open-source MCP server that gives any AI agent a USDC wallet, spending controls, and the ability to pay for x402 APIs autonomously.

## Features

- **Zero-config wallets** — works out of the box with no API keys or signup required
- **[Privy](https://www.privy.io/) HSM-backed keys** — keys never leave Privy's HSM/TEE infrastructure
- **Two wallet modes** — Proxy (zero-config default) or Privy direct (bring your own credentials)
- **Full x402 negotiation** — handles 402 → sign → retry automatically
- **EVM exact + escrow** — EIP-3009 TransferWithAuthorization and ReceiveWithAuthorization
- **Endpoint discovery** — fetches `.well-known/x402` documents and searches [x402scan.com](https://x402scan.com)
- **Spending controls** — per-call maximum and daily cap with automatic enforcement
- **Transaction history** — append-only log of every payment
- **10 MCP tools** — everything an agent needs to discover, query, pay, and audit

## Quick Start

No API keys or signup required. Just install and go:

### Claude Code

```bash
claude mcp add x402-wallet -- npx x402-wallet-mcp
```

### Cursor / Windsurf / Claude Desktop

Add to your MCP config file (`.mcp.json`, `~/.cursor/mcp.json`, or Claude Desktop settings):

```json
{
  "mcpServers": {
    "x402-wallet": {
      "command": "npx",
      "args": ["x402-wallet-mcp"]
    }
  }
}
```

On first run an HSM-backed wallet is automatically provisioned via the [x402 provisioning service](https://x402.onchainexpat.com). Send USDC on Base to the address it prints (in MCP client logs) and start making paid API calls.

The wallet ID and secret are saved to `~/.x402-wallet/config.json` for reuse across sessions.

### Power Users: Bring Your Own Privy Credentials

For full control, sign up for a [Privy](https://www.privy.io/) account and pass your own credentials. This bypasses the proxy and talks directly to Privy:

```bash
claude mcp add x402-wallet \
  -e PRIVY_APP_ID=your-app-id \
  -e PRIVY_APP_SECRET=your-app-secret \
  -- npx x402-wallet-mcp
```

With your own Privy credentials, you can recover your wallet at [home.privy.io](https://home.privy.io) using email/phone + 2FA.

## How It Works

```
┌──────────────┐     1. POST /api/data          ┌──────────────┐
│              │ ──────────────────────────────→  │              │
│   AI Agent   │     2. 402 + price: $0.002      │  x402 Server │
│  (via MCP)   │ ←──────────────────────────────  │              │
│              │     3. POST + X-PAYMENT header   │              │
│              │ ──────────────────────────────→  │              │
│              │     4. 200 + data                │              │
│              │ ←──────────────────────────────  │              │
└──────────────┘                                  └──────────────┘
       │                                                 │
       │ sign EIP-3009                                   │ verify signature
       │ TransferWithAuthorization                       │ settle USDC on Base
       ▼                                                 ▼
┌──────────────┐                                  ┌──────────────┐
│ x402-wallet  │                                  │   USDC on    │
│  (Privy HSM) │                                  │     Base     │
└──────────────┘                                  └──────────────┘
```

1. The agent calls `call_endpoint` with a URL
2. The server returns HTTP 402 with payment requirements (`accepts` array)
3. x402-wallet-mcp picks the best payment option, checks spending limits, signs an EIP-3009 authorization
4. Retries the request with the signed payment in the `X-PAYMENT` header
5. Returns the API response to the agent and logs the transaction

## MCP Tools

The server exposes 10 tools that any MCP client can call:

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `call_endpoint` | **Make a paid API call** (handles full 402 flow) | `url`, `method?`, `body?`, `headers?`, `prefer_escrow?` |
| `query_endpoint` | Probe pricing without paying | `url`, `method?` |
| `discover_endpoints` | Search for available x402 APIs | `query?`, `source?` |
| `check_balance` | USDC balance on Base + deposit address | — |
| `wallet_info` | Wallet mode, addresses, recovery status | — |
| `transaction_history` | Recent payment log | `limit?` |
| `configure_spending` | Set per-call max and daily cap | `per_call_max?`, `daily_cap?` |
| `add_endpoint_source` | Register a `.well-known/x402` source | `base_url` |
| `manage_allowlist` | Add/remove merchant allowlist entries | `allow?`, `remove?`, `mode?` |
| `fund_wallet` | Get Coinbase onramp link to buy USDC | `amount?` |

### Example: Paid API Call

When an agent calls `call_endpoint`:

```json
{
  "url": "https://x402.onchainexpat.com/api/x402-tools/hackernews/top",
  "method": "POST",
  "body": "{\"num_stories\": 5}"
}
```

The tool returns:

```json
{
  "success": true,
  "status": 200,
  "amountPaid": "0.002000",
  "scheme": "exact",
  "network": "eip155:8453",
  "data": {
    "stories": ["..."]
  }
}
```

## Spending Controls

Built-in safeguards prevent runaway spending:

| Control | Default | Override Env Var |
|---------|---------|------------------|
| Per-call maximum | $5.00 USDC | `X402_PER_CALL_MAX` |
| Daily cap | $50.00 USDC | `X402_DAILY_CAP` |

The daily cap resets at midnight UTC. Both limits can also be changed at runtime using the `configure_spending` tool.

If a payment would exceed either limit, the tool returns an error explaining why — the agent can then ask the user for approval or skip the call.

## Payment Schemes

### Exact (EIP-3009 TransferWithAuthorization)

The default and most common scheme. Signs a one-time USDC transfer authorization:

- **Domain**: USDC contract on Base (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)
- **Type**: `TransferWithAuthorization(from, to, value, validAfter, validBefore, nonce)`
- **Expiry**: Configurable via `maxTimeoutSeconds` (default 60s)
- **Nonce**: Random 32 bytes (one-time use)

### Escrow (EIP-3009 ReceiveWithAuthorization)

For endpoints that use the [x402r escrow middleware](https://github.com/coinbase/x402). Funds are held in escrow and settled after the API response:

- **Type**: `ReceiveWithAuthorization(from, to, value, validAfter, validBefore, nonce)`
- **to**: Token collector contract (not the final recipient)
- **Nonce**: Deterministic — computed from `keccak256(chainId, escrowAddress, paymentInfoHash)`
- **Expiry**: `validAfter=0`, `validBefore=MAX_UINT48`

The tool auto-detects which scheme to use based on the server's `accepts` array. By default it prefers exact; pass `prefer_escrow: true` to prefer escrow when both are available.

## Configuration

### Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `PRIVY_APP_ID` | Privy application ID (enables direct Privy mode) | No |
| `PRIVY_APP_SECRET` | Privy application secret | No |
| `X402_PROXY_URL` | Custom proxy URL (default: `https://x402.onchainexpat.com/api/wallet`) | No |
| `X402_PER_CALL_MAX` | Max USDC per API call (e.g. `"10.00"`) | No |
| `X402_DAILY_CAP` | Max USDC per day (e.g. `"100.00"`) | No |
| `X402_RPC_URL` | Custom Base RPC endpoint | No |
| `CDP_API_KEY_ID` | Coinbase onramp API key | No |
| `CDP_API_KEY_SECRET` | Coinbase onramp API secret | No |

**Wallet mode priority:** If `PRIVY_APP_ID` and `PRIVY_APP_SECRET` are set, the wallet connects directly to Privy. Otherwise, it uses the hosted proxy for zero-config operation.

### Data Directory

All persistent data is stored in `~/.x402-wallet/`:

```
~/.x402-wallet/
├── config.json          # Settings, wallet ID, endpoint sources
├── history.jsonl        # Transaction log (append-only)
├── spending.json        # Daily spending tracker
└── endpoints-cache.json # Discovery cache (1hr TTL)
```

### Default Configuration

```json
{
  "version": 1,
  "wallet": { "mode": "proxy", "proxyWalletId": null, "proxyWalletSecret": null },
  "spending": { "perCallMaxUsdc": "5.00", "dailyCapUsdc": "50.00" },
  "endpointSources": ["https://x402.onchainexpat.com", "https://padelmaps.org"],
  "preferences": { "preferEscrow": false, "preferredNetwork": "evm" }
}
```

> **Note:** The default mode is `"proxy"` (zero-config). When `PRIVY_APP_ID` and `PRIVY_APP_SECRET` env vars are set, the wallet automatically switches to `"privy"` mode with `privyWalletId` instead.

## Architecture

```
x402-wallet-mcp/
├── bin/
│   └── x402-wallet-mcp.ts          # CLI entry point
├── src/
│   ├── index.ts                     # Main: wallet + MCP server + stdio
│   ├── server.ts                    # McpServer with 10 tools
│   ├── wallet/
│   │   ├── types.ts                 # WalletProvider interface
│   │   ├── proxy-wallet.ts          # Zero-config wallet via hosted proxy
│   │   ├── proxy-api.ts             # REST client for proxy service
│   │   ├── privy-wallet.ts          # Direct Privy server wallets (HSM/TEE)
│   │   ├── privy-api.ts             # REST client for Privy API
│   │   └── factory.ts               # Wallet creation (proxy or privy)
│   ├── payment/
│   │   ├── evm-exact.ts             # EIP-3009 TransferWithAuthorization
│   │   ├── evm-escrow.ts            # ReceiveWithAuthorization + nonce
│   │   ├── negotiator.ts            # 402 → sign → retry orchestrator
│   │   ├── types.ts                 # AcceptEntry, PaymentRequired, etc.
│   │   └── constants.ts             # USDC addresses, chain IDs
│   ├── discovery/
│   │   ├── well-known.ts            # Fetch .well-known/x402
│   │   ├── x402scan.ts              # Query x402scan.com
│   │   └── registry.ts              # Merge + deduplicate + cache
│   ├── spending/
│   │   ├── tracker.ts               # Per-call + daily cap enforcement
│   │   └── store.ts                 # Persist daily spend totals
│   ├── tools/                       # 10 MCP tool implementations
│   ├── store/
│   │   ├── config.ts                # ~/.x402-wallet/config.json
│   │   ├── history.ts               # Append-only JSONL transaction log
│   │   └── paths.ts                 # Cross-platform path resolution
│   └── utils/
│       ├── logger.ts                # stderr-only (stdout = MCP JSON-RPC)
│       ├── http.ts                  # Fetch with timeout + retries
│       └── format.ts                # USDC atomic ↔ human-readable
└── tests/
    ├── unit/                        # 105 tests across 14 files
    ├── integration/                 # Live endpoint tests (costs real USDC)
    └── e2e/                         # Full MCP server over stdio
```

## Development

### Prerequisites

- Node.js >= 18
- npm

### Setup

```bash
git clone https://github.com/onchainexpat/x402-wallet-mcp.git
cd x402-wallet-mcp
npm install
```

### Build

```bash
npm run build       # TypeScript → dist/
npm run lint        # Type-check without emitting
```

### Run in Development

```bash
npm run dev         # Run with tsx (auto-reloads)
```

### Testing

```bash
# Unit tests (105 tests, no network calls, no USDC spent)
npm test

# Watch mode
npm run test:watch

# Integration tests (hits real x402 endpoints, costs real USDC)
# Requires a funded wallet
RUN_LIVE_TESTS=1 npm run test:live

# E2E tests (spawns MCP server over stdio, calls all 10 tools)
RUN_E2E_TESTS=1 npx vitest run tests/e2e
```

The unit test suite covers:
- **Wallet**: Proxy + Privy API mocking, factory routing (env var detection)
- **Payment**: EIP-3009 exact/escrow signing, escrow nonce determinism, full negotiator flow (402 → sign → retry), edge cases (double-402, empty accepts, spending limits)
- **Spending**: per-call max, daily cap, midnight reset, env var overrides
- **Discovery**: endpoint merging, deduplication, cache behavior, fetch failure handling
- **Store**: config defaults/persistence, history append/query, USDC formatting

### Local Testing with an MCP Client

```bash
# Build and run
npm run build
node dist/bin/x402-wallet-mcp.js

# Or use npx to test the published package experience
npx .
```

The server communicates over stdio (JSON-RPC), so you need an MCP client to interact with it. The easiest way is to add it to Claude Code's config and test through the chat.

## Terminology

| Term | Definition |
|------|------------|
| **x402** | Protocol for HTTP 402 payments — servers price API calls, clients pay with crypto |
| **MCP** | [Model Context Protocol](https://modelcontextprotocol.io/) — standard for AI tool servers |
| **EIP-3009** | Ethereum standard for gasless USDC transfers via signed authorizations |
| **Base** | Coinbase's L2 network where USDC payments settle |
| **Exact** | Direct payment scheme — USDC transfers immediately to the server |
| **Escrow** | Protected payment scheme — funds held in smart contract, settled after API response |

## Security Considerations

> [!IMPORTANT]
> This software manages real cryptocurrency. Review the [security policy](SECURITY.md) before using in production.

- **HSM-backed keys**: Whether using proxy or direct Privy mode, keys never leave Privy's HSM/TEE infrastructure.
- **Proxy signing validation**: The hosted proxy validates every signing request — only USDC transfers on Base, capped at 100 USDC per transaction.
- **Spending limits**: Enforced locally before signing. Cannot be bypassed by the AI agent.
- **No stdout leaks**: All logging goes to stderr. stdout is reserved for MCP JSON-RPC. Private keys never appear in logs.

## Roadmap

- [ ] Multi-chain support (Ethereum mainnet, Arbitrum, Optimism)
- [ ] Payment receipts and on-chain verification
- [ ] Webhook notifications for payments
- [ ] Rate limiting and circuit breaker patterns
- [ ] Dashboard UI for spending analytics

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Before submitting a PR:

1. Run `npm test` and ensure all 105 tests pass
2. Run `npm run lint` for type checking
3. Add tests for new functionality
4. Keep PRs focused — one feature or fix per PR

## Related Projects

- [x402](https://github.com/coinbase/x402) — The x402 protocol specification by Coinbase
- [MCP](https://modelcontextprotocol.io/) — Model Context Protocol by Anthropic
- [viem](https://viem.sh/) — TypeScript library for Ethereum (used for signing)
- [x402scan.com](https://x402scan.com) — Directory of x402-enabled endpoints

## License

[MIT](LICENSE)
