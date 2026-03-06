import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/wallet/link-api.js", () => ({
  createLinkSession: vi.fn().mockResolvedValue({
    session_id: "session-tool-123",
    link_url: "https://x402.onchainexpat.com/link/session-tool-123",
  }),
  pollLinkStatus: vi.fn(),
}));

describe("wallet_link tool", () => {
  it("returns link URL when wallet is not linked", async () => {
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

    expect(data.status).toBe("not_linked");
    expect(data.link_url).toBe("https://x402.onchainexpat.com/link/session-tool-123");
    expect(data.instructions).toBeTruthy();
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
