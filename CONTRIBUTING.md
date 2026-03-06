# Contributing to x402-wallet-mcp

Thanks for your interest in contributing. This guide will help you get started.

## Development Setup

```bash
git clone https://github.com/onchainexpat/x402-wallet-mcp.git
cd x402-wallet-mcp
npm install
npm run build
npm test
```

Requires Node.js >= 18.

## Making Changes

1. Fork the repository and create a branch from `main`
2. Make your changes
3. Add or update tests as needed
4. Run `npm test` (all 101 tests must pass)
5. Run `npm run lint` (no type errors)
6. Commit with a clear message describing what and why
7. Open a pull request

## Code Style

- TypeScript strict mode
- ES modules (`import`/`export`, not `require`)
- All logging to stderr via `src/utils/logger.ts` (stdout is reserved for MCP JSON-RPC)
- No `console.log` — use `logger.info`, `logger.warn`, `logger.error`

## Testing

### Unit Tests

Unit tests live in `tests/unit/` and mirror the `src/` directory structure. They use [vitest](https://vitest.dev/) with mocked I/O:

- File operations use temp directories via `mkdtempSync` + path mocks
- Network calls use `vi.stubGlobal("fetch", mockFetch)`
- External APIs (Privy) use injected interfaces for mockability

```bash
npm test              # Run all unit tests
npm run test:watch    # Watch mode
```

### Integration Tests

Integration tests in `tests/integration/` hit real x402 endpoints and cost real USDC. They are gated behind `RUN_LIVE_TESTS=1`:

```bash
RUN_LIVE_TESTS=1 npm run test:live
```

### E2E Tests

E2E tests spawn the full MCP server over stdio and call all 8 tools:

```bash
RUN_E2E_TESTS=1 npx vitest run tests/e2e
```

### Writing Tests

- Every new feature or bug fix should include tests
- Mock external dependencies; don't make network calls in unit tests
- Use the existing mock patterns (see `tests/unit/wallet/privy-wallet.test.ts` for the injected interface pattern)

## Project Structure

```
src/
├── wallet/      # WalletProvider implementations (local, BYOK, Privy)
├── payment/     # EIP-3009 signing and 402 negotiation
├── discovery/   # .well-known/x402 and x402scan.com
├── spending/    # Per-call and daily spending limits
├── tools/       # 8 MCP tool implementations
├── store/       # Config, history, path resolution
└── utils/       # Logger, HTTP, formatting
```

## What We're Looking For

- Bug fixes with regression tests
- New payment schemes (Solana, additional EVM chains)
- Improved error messages and edge case handling
- Documentation improvements
- Performance optimizations with benchmarks

## What to Avoid

- Breaking changes to the MCP tool interface without discussion
- Adding dependencies without justification
- Changes that print to stdout (breaks MCP transport)
- Committing private keys, secrets, or `.env` files

## Reporting Issues

Open an issue on GitHub with:

1. What you expected to happen
2. What actually happened
3. Steps to reproduce
4. Node.js version and OS

## Questions?

Open a discussion on GitHub or reach out on [X/Twitter](https://x.com/onchainexpat).
