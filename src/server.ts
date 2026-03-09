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
import { walletRecoverTool } from "./tools/wallet-recover.js";
import { exportKeyTool } from "./tools/export-key.js";

type ToolResult = {
  [x: string]: unknown;
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  isError?: boolean;
};

const SETUP_RESPONSE: ToolResult = {
  content: [
    {
      type: "text" as const,
      text: JSON.stringify(
        {
          error: "wallet_not_configured",
          message:
            "No wallet configured yet. Use the wallet_link tool to create a wallet linked to your email.",
        },
        null,
        2,
      ),
    },
  ],
  isError: true,
};

/** Wrap a handler so it blocks when no wallet is set up. */
function guardWallet<P>(
  wallet: WalletProvider,
  handler: (params: P) => Promise<ToolResult>,
): (params: P) => Promise<ToolResult> {
  return async (params: P) => {
    if (wallet.mode === "setup_required") return SETUP_RESPONSE;
    return handler(params);
  };
}

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
    guardWallet(wallet, () => walletInfo.handler()),
  );

  const checkBalance = checkBalanceTool(wallet);
  server.tool(
    checkBalance.name,
    checkBalance.description,
    {},
    guardWallet(wallet, () => checkBalance.handler()),
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
    guardWallet(wallet, (params) => callEndpoint.handler(params)),
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
    guardWallet(wallet, (params) => fundWallet.handler(params)),
  );

  const walletLink = walletLinkTool(wallet);
  server.tool(
    walletLink.name,
    walletLink.description,
    {
      email: z
        .string()
        .optional()
        .describe("Email address to link (Step 1: sends verification code)"),
      session_token: z
        .string()
        .optional()
        .describe("Session token from Step 1 (Step 2: verify code)"),
      code: z
        .string()
        .optional()
        .describe("6-digit verification code from email (Step 2)"),
    },
    async (params) => walletLink.handler(params),
  );

  const exportKey = exportKeyTool(wallet);
  server.tool(
    exportKey.name,
    exportKey.description,
    {},
    guardWallet(wallet, () => exportKey.handler()),
  );

  const walletRecover = walletRecoverTool();
  server.tool(
    walletRecover.name,
    walletRecover.description,
    {
      email: z
        .string()
        .optional()
        .describe(
          "Email previously linked to your wallet (Step 1: sends verification code)",
        ),
      session_token: z
        .string()
        .optional()
        .describe("Session token from Step 1 (Step 2: verify code)"),
      code: z
        .string()
        .optional()
        .describe("6-digit verification code from email (Step 2)"),
      wallet_id: z
        .string()
        .optional()
        .describe("Wallet ID to select (Step 3: when multiple wallets exist)"),
    },
    async (params) => walletRecover.handler(params),
  );

  return server;
}
