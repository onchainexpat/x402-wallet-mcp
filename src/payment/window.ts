/**
 * How long a signed payment authorization stays usable.
 *
 * A server says in `maxTimeoutSeconds` how long it needs before it settles.
 * Both signers give the authorization exactly that long, so an authorization
 * the server never uses expires instead of standing forever. The server
 * controls the field, so it is bounded here: real servers ask for 60 to 300
 * seconds, and anything unusable falls back to the default.
 */

export const DEFAULT_AUTHORIZATION_WINDOW_SECONDS = 60;
export const MAX_AUTHORIZATION_WINDOW_SECONDS = 3600;

export function authorizationWindowSeconds(maxTimeoutSeconds: unknown): number {
  // JSON may carry "300"; adding a string to a timestamp would concatenate.
  const n = typeof maxTimeoutSeconds === "string" ? Number(maxTimeoutSeconds) : maxTimeoutSeconds;
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) {
    return DEFAULT_AUTHORIZATION_WINDOW_SECONDS;
  }
  return Math.min(n, MAX_AUTHORIZATION_WINDOW_SECONDS);
}
