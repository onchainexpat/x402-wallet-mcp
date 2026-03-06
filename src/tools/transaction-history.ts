import { readTransactions } from "../store/history.js";
import { formatUsdc } from "../utils/format.js";

export function transactionHistoryTool() {
  return {
    name: "transaction_history",
    description: "View recent payment transactions",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Number of recent transactions to show (default: 20, max: 100)",
        },
      },
    },
    handler: async (params: { limit?: number }) => {
      const limit = Math.min(params.limit ?? 20, 100);
      const transactions = readTransactions(limit);

      const summary = transactions.map((tx) => ({
        timestamp: tx.timestamp,
        url: tx.url,
        method: tx.method,
        scheme: tx.scheme,
        network: tx.network,
        amount: formatUsdc(BigInt(tx.amount)),
        status: tx.status,
        error: tx.error,
      }));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { count: summary.length, transactions: summary },
              null,
              2,
            ),
          },
        ],
      };
    },
  };
}
