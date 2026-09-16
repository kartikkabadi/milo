import type { Env } from "../env.ts";

/**
 * The bearer check behind MILO_ADMIN_TOKEN.
 *
 * Two ways to carry the token:
 *   - `Authorization: Bearer <token>` for ordinary fetch calls
 *   - `?token=<token>` on the /agents/ upgrade URL, because a browser
 *     WebSocket handshake cannot set headers
 *
 * Callers decide the policy; this only answers "did they present it".
 * When no token is configured the check passes — the local-dev default.
 */
export function isAuthorized(request: Request, env: Env): boolean {
  const token = env.MILO_ADMIN_TOKEN;
  if (!token) return true;
  if (request.headers.get("authorization") === `Bearer ${token}`) return true;
  return new URL(request.url).searchParams.get("token") === token;
}
