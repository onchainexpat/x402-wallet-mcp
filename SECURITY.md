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

- **Key exposure**: Private keys are never stored on your machine — not in plaintext, not encrypted, not anywhere. All keys live in Privy's HSM/TEE secure enclaves.
- **Key exposure in logs**: Private keys never appear in log output. All logging goes to stderr.
- **Service disappearance**: If this package or the x402 provisioning service goes offline, you can always export your private key at [home.privy.io](https://home.privy.io) using your linked email.
- **Runaway spending**: Per-call maximum and daily cap enforced locally before signing.
- **Replay attacks**: Exact payments use random nonces. Escrow payments use deterministic nonces tied to payment parameters.
- **File permission escalation**: Config files created with `0600` permissions.

### What x402-wallet-mcp Does NOT Protect Against

- **Local machine compromise**: An attacker with access to `~/.x402-wallet/config.json` could read your wallet ID and proxy secret, enabling them to sign transactions through the proxy service (subject to its rate limits and per-tx caps). Link your email and use spending limits as defense in depth.
- **AI agent manipulation**: If an AI agent is tricked into calling `call_endpoint` with a malicious URL, spending limits are the last line of defense. Set conservative limits.
- **Network-level attacks**: HTTPS is assumed. The server does not implement certificate pinning.
- **Smart contract bugs**: Payment verification happens on-chain. This project signs payments but does not verify the receiving contracts.

## Recommendations

| Environment | Wallet Mode | Spending Limits |
|-------------|-------------|-----------------|
| Personal/dev | Proxy + email link | Default ($5/$50) |
| CI/CD | BYOK (direct Privy) | Tight limits |
| Production | BYOK (direct Privy) | Configured per use case |

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

We will backport critical security fixes to supported versions.
