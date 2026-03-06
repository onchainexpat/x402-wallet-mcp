# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in x402-wallet-mcp, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, email: **security@onchainexpat.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and provide a timeline for a fix.

## Scope

This policy covers:

- Key management (keystore encryption, key derivation, key exposure)
- Payment signing (signature construction, nonce generation, replay attacks)
- Spending controls (limit bypass, overflow/underflow)
- MCP transport (stdout/stderr isolation, JSON-RPC injection)
- Data storage (config, history, keystore file permissions)

## Security Model

### What x402-wallet-mcp Protects Against

- **Key exposure in logs**: Private keys never appear in log output. All logging goes to stderr.
- **Plaintext key storage**: Local mode encrypts keys with AES-256-GCM (scrypt key derivation).
- **Runaway spending**: Per-call maximum and daily cap enforced locally before signing.
- **Replay attacks**: Exact payments use random nonces. Escrow payments use deterministic nonces tied to payment parameters.
- **File permission escalation**: Keystore created with `0600` permissions.

### What x402-wallet-mcp Does NOT Protect Against

- **Local machine compromise**: If an attacker has access to your machine and can read `~/.x402-wallet/keystore.json` and knows (or can guess) the encryption password, they can extract the private key. Use `X402_WALLET_PASSWORD` with a strong password, or use Privy mode for production.
- **Default password weakness**: The convenience default password is derived from `hostname + username`. This is NOT secure against local attackers. It only prevents accidental key loss.
- **AI agent manipulation**: If an AI agent is tricked into calling `call_endpoint` with a malicious URL, spending limits are the last line of defense. Set conservative limits.
- **Network-level attacks**: HTTPS is assumed. The server does not implement certificate pinning.
- **Smart contract bugs**: Payment verification happens on-chain. This project signs payments but does not verify the receiving contracts.

## Recommendations

| Environment | Wallet Mode | Password | Spending Limits |
|-------------|-------------|----------|-----------------|
| Personal/dev | Local | Set `X402_WALLET_PASSWORD` | Default ($5/$50) |
| CI/CD | BYOK | N/A | Tight limits |
| Production | Privy | N/A | Configured per use case |

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

We will backport critical security fixes to supported versions.
