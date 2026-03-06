/**
 * E2E test — spawns MCP server over stdio, calls tools.
 * Verifies responses are well-formed JSON matching expected schemas.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SHOULD_RUN = process.env.RUN_E2E_TESTS === "1";

describe.skipIf(!SHOULD_RUN)("E2E: MCP server full flow", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: "tsx",
      args: ["bin/x402-wallet-mcp.ts"],
      env: {
        ...process.env,
        PRIVY_APP_ID: process.env.PRIVY_APP_ID || "test-app-id",
        PRIVY_APP_SECRET: process.env.PRIVY_APP_SECRET || "test-app-secret",
      },
    });

    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    await client?.close();
  });

  it("lists all 10 tools", async () => {
    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name).sort();
    expect(toolNames).toEqual([
      "add_endpoint_source",
      "call_endpoint",
      "check_balance",
      "configure_spending",
      "discover_endpoints",
      "fund_wallet",
      "manage_allowlist",
      "query_endpoint",
      "transaction_history",
      "wallet_info",
    ]);
  });

  it("wallet_info returns valid address", async () => {
    const result = await client.callTool({ name: "wallet_info", arguments: {} });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const data = JSON.parse(text);
    expect(data.mode).toBe("privy");
    expect(data.evmAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("check_balance returns balance info", async () => {
    const result = await client.callTool({ name: "check_balance", arguments: {} });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const data = JSON.parse(text);
    expect(data.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(data.network).toBe("Base (eip155:8453)");
  });

  it("transaction_history returns array", async () => {
    const result = await client.callTool({
      name: "transaction_history",
      arguments: { limit: 5 },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const data = JSON.parse(text);
    expect(data.transactions).toBeInstanceOf(Array);
  });

  it("configure_spending returns limits", async () => {
    const result = await client.callTool({
      name: "configure_spending",
      arguments: {},
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const data = JSON.parse(text);
    expect(data.perCallMax).toBeDefined();
    expect(data.dailyCap).toBeDefined();
  });

  it("query_endpoint probes pricing", async () => {
    const result = await client.callTool({
      name: "query_endpoint",
      arguments: {
        url: "https://x402.onchainexpat.com/api/x402-tools/hackernews/top",
      },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const data = JSON.parse(text);
    // Should be 402 with payment options, or not_paid if unreachable
    expect(data.paymentOptions || data.status).toBeDefined();
  });
});
