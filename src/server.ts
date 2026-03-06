import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WalletProvider } from "./wallet/types.js";
import { walletInfoTool } from "./tools/wallet-info.js";
import { checkBalanceTool } from "./tools/check-balance.js";
import { callEndpointTool } from "./tools/call-endpoint.js";
import { queryEndpointTool } from "./tools/query-endpoint.js";
import { discoverEndpointsTool } from "./tools/discover-endpoints.js";
import { transactionHistoryTool } from "./tools/transaction-history.js";
import { configureSpendingTool } from "./tools/configure-spending.js";
import { addEndpointSourceTool } from "./tools/add-endpoint-source.js";
import { manageAllowlistTool } from "./tools/manage-allowlist.js";
import { fundWalletTool } from "./tools/fund-wallet.js";
import { walletLinkTool } from "./tools/wallet-link.js";

export function createServer(wallet: WalletProvider): McpServer {
  const server = new McpServer({
    name: "x402-wallet",
    version: "0.1.0",
  });

  // Register all 11 tools
  const walletInfo = walletInfoTool(wallet);
  server.tool(
    walletInfo.name,
    walletInfo.description,
    {},
    async () => walletInfo.handler(),
  );

  const checkBalance = checkBalanceTool(wallet);
  server.tool(
    checkBalance.name,
    checkBalance.description,
    {},
    async () => checkBalance.handler(),
  );

  const callEndpoint = callEndpointTool(wallet);
  server.tool(
    callEndpoint.name,
    callEndpoint.description,
    {
      url: z.string().describe("The full URL of the x402 endpoint to call"),
      method: z
        .enum(["GET", "POST", "PUT", "DELETE"])
        .optional()
        .describe("HTTP method (default: POST)"),
      body: z
        .string()
        .optional()
        .describe("JSON request body (for POST/PUT)"),
      headers: z
        .record(z.string())
        .optional()
        .describe("Additional HTTP headers"),
      prefer_escrow: z
        .boolean()
        .optional()
        .describe("Prefer escrow payment if available (default: false)"),
    },
    async (params) => callEndpoint.handler(params),
  );

  const queryEp = queryEndpointTool();
  server.tool(
    queryEp.name,
    queryEp.description,
    {
      url: z.string().describe("The full URL of the endpoint to probe"),
      method: z
        .enum(["GET", "POST"])
        .optional()
        .describe("HTTP method to use (default: POST)"),
    },
    async (params) => queryEp.handler(params),
  );

  const discover = discoverEndpointsTool();
  server.tool(
    discover.name,
    discover.description,
    {
      query: z
        .string()
        .optional()
        .describe("Search query to filter endpoints"),
      source: z
        .string()
        .optional()
        .describe("Filter by source URL"),
    },
    async (params) => discover.handler(params),
  );

  const history = transactionHistoryTool();
  server.tool(
    history.name,
    history.description,
    {
      limit: z
        .number()
        .optional()
        .describe("Number of recent transactions to show (default: 20)"),
    },
    async (params) => history.handler(params),
  );

  const spending = configureSpendingTool();
  server.tool(
    spending.name,
    spending.description,
    {
      per_call_max: z
        .string()
        .optional()
        .describe("Maximum USDC per single API call (e.g. '5.00')"),
      daily_cap: z
        .string()
        .optional()
        .describe("Maximum USDC per day (e.g. '50.00')"),
    },
    async (params) => spending.handler(params),
  );

  const addSource = addEndpointSourceTool();
  server.tool(
    addSource.name,
    addSource.description,
    {
      base_url: z
        .string()
        .optional()
        .describe("Base URL of a server with .well-known/x402 (e.g. 'https://api.example.com')"),
      endpoint_url: z
        .string()
        .optional()
        .describe("Direct URL of a single x402 endpoint (e.g. 'https://api.example.com/v1/search')"),
      description: z
        .string()
        .optional()
        .describe("Optional description for a custom endpoint"),
    },
    async (params) => addSource.handler(params),
  );

  const allowlist = manageAllowlistTool();
  server.tool(
    allowlist.name,
    allowlist.description,
    {
      allow: z
        .string()
        .optional()
        .describe("Ethereum address to add to the allowlist"),
      remove: z
        .string()
        .optional()
        .describe("Ethereum address to remove from the allowlist"),
      mode: z
        .enum(["on", "off"])
        .optional()
        .describe("Enable or disable the allowlist"),
    },
    async (params) => allowlist.handler(params),
  );

  const fundWallet = fundWalletTool(wallet);
  server.tool(
    fundWallet.name,
    fundWallet.description,
    {
      amount: z
        .number()
        .optional()
        .describe("USD amount to pre-fill (default: 25)"),
    },
    async (params) => fundWallet.handler(params),
  );

  const walletLink = walletLinkTool(wallet);
  server.tool(
    walletLink.name,
    walletLink.description,
    {},
    async () => walletLink.handler(),
  );

  return server;
}
