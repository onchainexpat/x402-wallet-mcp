import type { WalletProvider } from "../wallet/types.js";
import {
  createLinkSession,
  sendOtp,
  verifyOtp,
} from "../wallet/link-api.js";
import { loadConfig, saveConfig } from "../store/config.js";

export function walletLinkTool(wallet: WalletProvider) {
  return {
    name: "wallet_link",
    description:
      "Link your wallet to an email address for easy recovery. " +
      "If already linked, shows current status. " +
      "Step 1: Call with email to send a verification code. " +
      "Step 2: Call again with session_token, email, and code to complete linking.",
    handler: async (params: {
      email?: string;
      session_token?: string;
      code?: string;
    } = {}) => {
      const info = wallet.describe();

      // Already linked — show status
      if (
        info.mode === "linked" &&
        info.linkedEmail &&
        !params.session_token &&
        !params.email
      ) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "linked",
                  email: info.linkedEmail,
                  evmAddress: info.evmAddress,
                  message: "Wallet is already linked to your email.",
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // Step 2: Verify OTP and complete linking
      if (params.session_token && params.code && params.email) {
        const verified = await verifyOtp(
          params.session_token,
          params.email,
          params.code,
        );

        // wallet_secret comes directly from verify response — no polling needed
        const wt = (verified.wallet_type === "embedded" ? "embedded" : "server") as "server" | "embedded";
        const config = loadConfig();
        config.wallet = {
          mode: "linked",
          proxyWalletId: verified.wallet_id,
          proxyWalletSecret: verified.wallet_secret,
          linkedEmail: verified.email,
          walletType: wt,
        };
        saveConfig(config);

        const result: Record<string, unknown> = {
          status: "linked",
          wallet_id: verified.wallet_id,
          address: verified.address,
          email: verified.email,
          wallet_type: wt,
          message:
            "Wallet linked and config updated! Restart the MCP server to use the linked wallet.",
        };
        if (verified.old_wallet_id) {
          result.old_wallet_id = verified.old_wallet_id;
          result.warning = `Your wallet changed. If you had funds at the old wallet, transfer them to your new address.`;
        }
        if (wt === "embedded") {
          result.export_hint = "Your key is now exportable at https://home.privy.io";
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // Step 1: Create session and send OTP
      if (params.email) {
        const creds = wallet.getProxyCredentials?.() ?? undefined;
        const session = await createLinkSession(
          creds
            ? { walletId: creds.walletId, walletSecret: creds.walletSecret }
            : undefined,
        );

        const sent = await sendOtp(session.session_token, params.email);

        const baseUrl = process.env.X402_PROXY_URL
          ? process.env.X402_PROXY_URL.replace(/\/api\/wallet\/?$/, "")
          : "https://x402.onchainexpat.com";
        const fallbackUrl = session.link_url.startsWith("http")
          ? session.link_url
          : `${baseUrl}${session.link_url}`;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "otp_sent",
                  session_token: sent.session_token,
                  email: params.email,
                  instructions:
                    `A verification code has been sent to ${params.email}. ` +
                    "Ask the user for the 6-digit code, then call wallet_link again with session_token, email, and code.",
                  fallback_url: fallbackUrl,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // No params: tell the agent to ask for email
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                status: "need_email",
                instructions:
                  "Ask the user for their email address, " +
                  "then call wallet_link again with the email parameter.",
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  };
}
