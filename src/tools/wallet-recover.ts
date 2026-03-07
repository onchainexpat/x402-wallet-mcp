import {
  initiateRecovery,
  verifyOtp,
} from "../wallet/link-api.js";
import { loadConfig, saveConfig } from "../store/config.js";

export function walletRecoverTool() {
  return {
    name: "wallet_recover",
    description:
      "Recover a previously linked wallet by email. " +
      "Step 1: Call with email to send a verification code. " +
      "Step 2: Call again with the session_token and code to complete recovery. " +
      "Do NOT use wallet_link for recovery — it would link your email to the new wallet instead.",
    handler: async (params: {
      email?: string;
      session_token?: string;
      code?: string;
    } = {}) => {
      // Step 2: Verify OTP and recover wallet
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

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "recovered",
                  wallet_id: verified.wallet_id,
                  address: verified.address,
                  email: verified.email,
                  wallet_type: wt,
                  message:
                    "Wallet recovered and config updated! Restart the MCP server to use the recovered wallet.",
                  ...(wt === "embedded"
                    ? { export_hint: "Your key is exportable at https://home.privy.io" }
                    : {}),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // Step 1: Send OTP to email
      if (params.email) {
        const recovery = await initiateRecovery(params.email);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "otp_sent",
                  session_token: recovery.session_token,
                  email: params.email,
                  instructions:
                    `A verification code has been sent to ${params.email}. ` +
                    "Ask the user for the 6-digit code, then call wallet_recover again with session_token, email, and code.",
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
                  "Ask the user for the email address they previously linked to their wallet, " +
                  "then call wallet_recover again with the email parameter.",
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
