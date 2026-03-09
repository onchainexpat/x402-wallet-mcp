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
      "Step 2: Call again with the session_token, email, and code to complete recovery. " +
      "If multiple wallets exist, Step 2 returns a list — call again with wallet_id to select one. " +
      "Do NOT use wallet_link for recovery — it would link your email to the new wallet instead.",
    handler: async (params: {
      email?: string;
      session_token?: string;
      code?: string;
      wallet_id?: string;
    } = {}) => {
      // Step 3: Select a specific wallet from multi-wallet list
      if (params.session_token && params.wallet_id && params.email && params.code) {
        const verified = await verifyOtp(
          params.session_token,
          params.email,
          params.code,
          params.wallet_id,
        );

        // If still returning choose_wallet, something went wrong
        if (verified.status === "choose_wallet") {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                status: "error",
                message: "Wallet selection failed. The wallet_id may be invalid.",
                wallets: verified.wallets,
              }, null, 2),
            }],
          };
        }

        return saveAndReturnRecovery(verified);
      }

      // Step 2: Verify OTP and recover wallet
      if (params.session_token && params.code && params.email) {
        const verified = await verifyOtp(
          params.session_token,
          params.email,
          params.code,
        );

        // Multi-wallet: return list for user to choose
        if (verified.status === "choose_wallet" && verified.wallets) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                status: "choose_wallet",
                email: params.email,
                wallets: verified.wallets,
                session_token: verified.session_token || params.session_token,
                code: params.code,
                instructions:
                  `Found ${verified.wallets.length} wallets for this email. ` +
                  "Show the user the wallet addresses and ask them to choose one. " +
                  "Then call wallet_recover again with session_token, email, code, and the chosen wallet_id.",
              }, null, 2),
            }],
          };
        }

        return saveAndReturnRecovery(verified);
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

function saveAndReturnRecovery(verified: {
  wallet_id: string;
  address: string;
  email: string;
  wallet_secret: string;
  wallet_type?: string;
}) {
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
