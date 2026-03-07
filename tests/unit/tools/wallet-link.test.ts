import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/wallet/link-api.js", () => ({
  createLinkSession: vi.fn().mockResolvedValue({
    session_token: "jwt-session-token-123",
    link_url: "https://x402.onchainexpat.com/wallet/link?session=jwt-session-token-123",
  }),
  sendOtp: vi.fn().mockResolvedValue({
    ok: true,
    message: "OTP sent",
    session_token: "jwt-session-token-updated",
  }),
  verifyOtp: vi.fn().mockResolvedValue({
    ok: true,
    wallet_id: "recovered-wallet",
    address: "0xrecovered",
    email: "test@example.com",
    wallet_secret: "new-secret-123",
    wallet_type: "embedded",
  }),
  initiateRecovery: vi.fn(),
}));

vi.mock("../../../src/store/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    version: 1,
    wallet: { mode: "proxy", proxyWalletId: "test-id", proxyWalletSecret: "test-secret" },
    spending: { perCallMaxUsdc: "5.00", dailyCapUsdc: "50.00" },
    endpointSources: [],
    customEndpoints: [],
    preferences: { preferEscrow: false, preferredNetwork: "evm" },
    allowlist: { enabled: false, merchants: [] },
  }),
  saveConfig: vi.fn(),
}));

describe("wallet_link tool", () => {
  it("returns need_email when called with no params", async () => {
    const { walletLinkTool } = await import("../../../src/tools/wallet-link.js");

    const mockWallet = {
      mode: "proxy" as const,
      getEvmAddress: () => "0xaaaa",
      signTypedData: vi.fn(),
      describe: () => ({
        mode: "proxy" as const,
        evmAddress: "0xaaaa",
        recoverable: true,
      }),
    };

    const tool = walletLinkTool(mockWallet);
    const result = await tool.handler();
    const data = JSON.parse(result.content[0].text);

    expect(data.status).toBe("need_email");
    expect(data.instructions).toBeTruthy();
  });

  it("sends OTP when called with email", async () => {
    const linkApi = await import("../../../src/wallet/link-api.js");
    const { walletLinkTool } = await import("../../../src/tools/wallet-link.js");

    const mockWallet = {
      mode: "proxy" as const,
      getEvmAddress: () => "0xaaaa",
      signTypedData: vi.fn(),
      describe: () => ({
        mode: "proxy" as const,
        evmAddress: "0xaaaa",
        recoverable: true,
      }),
      getProxyCredentials: () => ({
        walletId: "proxy-cred-wallet",
        walletSecret: "proxy-cred-secret",
      }),
    };

    const tool = walletLinkTool(mockWallet);
    const result = await tool.handler({ email: "test@example.com" });
    const data = JSON.parse(result.content[0].text);

    expect(data.status).toBe("otp_sent");
    expect(data.session_token).toBe("jwt-session-token-updated");
    expect(data.email).toBe("test@example.com");
    expect(linkApi.createLinkSession).toHaveBeenCalledWith({
      walletId: "proxy-cred-wallet",
      walletSecret: "proxy-cred-secret",
    });
    expect(linkApi.sendOtp).toHaveBeenCalledWith("jwt-session-token-123", "test@example.com");
  });

  it("verifies OTP and updates config when called with session_token + code", async () => {
    const linkApi = await import("../../../src/wallet/link-api.js");
    const configMod = await import("../../../src/store/config.js");
    const { walletLinkTool } = await import("../../../src/tools/wallet-link.js");

    const mockWallet = {
      mode: "proxy" as const,
      getEvmAddress: () => "0xaaaa",
      signTypedData: vi.fn(),
      describe: () => ({
        mode: "proxy" as const,
        evmAddress: "0xaaaa",
        recoverable: true,
      }),
    };

    const tool = walletLinkTool(mockWallet);
    const result = await tool.handler({
      session_token: "jwt-session-token-123",
      email: "test@example.com",
      code: "123456",
    });
    const data = JSON.parse(result.content[0].text);

    expect(data.status).toBe("linked");
    expect(data.wallet_id).toBe("recovered-wallet");
    expect(data.address).toBe("0xrecovered");
    expect(linkApi.verifyOtp).toHaveBeenCalledWith("jwt-session-token-123", "test@example.com", "123456");
    expect(configMod.saveConfig).toHaveBeenCalled();
  });

  it("returns linked status when wallet is already linked", async () => {
    const { walletLinkTool } = await import("../../../src/tools/wallet-link.js");

    const mockWallet = {
      mode: "linked" as const,
      getEvmAddress: () => "0xbbbb",
      signTypedData: vi.fn(),
      describe: () => ({
        mode: "linked" as const,
        evmAddress: "0xbbbb",
        recoverable: true,
        linkedEmail: "linked@example.com",
      }),
    };

    const tool = walletLinkTool(mockWallet);
    const result = await tool.handler();
    const data = JSON.parse(result.content[0].text);

    expect(data.status).toBe("linked");
    expect(data.email).toBe("linked@example.com");
    expect(data.evmAddress).toBe("0xbbbb");
  });
});
