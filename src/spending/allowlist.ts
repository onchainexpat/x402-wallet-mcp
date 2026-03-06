import { loadConfig } from "../store/config.js";

export interface AllowlistCheck {
  allowed: boolean;
  reason?: string;
}

/** Check if a merchant address is on the allowlist */
export function checkMerchantAllowlist(
  payTo: string,
  url: string,
): AllowlistCheck {
  const config = loadConfig();

  if (!config.allowlist.enabled) {
    return { allowed: true };
  }

  const normalized = payTo.toLowerCase();
  if (config.allowlist.merchants.includes(normalized)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason:
      `Merchant address ${payTo} is not on your allowlist. ` +
      `Endpoint: ${url}\n\n` +
      `To allow this merchant, use the manage_allowlist tool:\n` +
      `  manage_allowlist({ allow: "${payTo}" })`,
  };
}
