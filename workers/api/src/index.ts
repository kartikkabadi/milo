/**
 * Milo control plane entry point.
 *
 * Exports, in one place, everything wrangler needs to find:
 *   MiloSession   — one Durable Object per agent session
 *   ContainerGate — the single-lease queue in front of max_instances: 1
 *   AuthVault     — the provider-credential store behind the Connect panel
 *   Sandbox       — the container-backed Sandbox subclass
 *
 * On credentials, and a correction worth stating
 * ---------------------------------------------
 * The brief asks for "outbound allowlist + credential injection". That is a
 * `@cloudflare/sandbox` **1.0 preview** feature: the preview adds `enableInternet`,
 * `allowedHosts`, `deniedHosts`, and static `outbound` / `outboundByHost`
 * handlers, and requires exporting `ContainerProxy` from this entrypoint.
 *
 * Milo pins the **stable 0.6.x** line instead, because the stable `exec` returns
 * `{ success, exitCode, stdout, stderr }` and the preview replaces it with a
 * process handle. Rewriting the whole snapshot path against a preview API to
 * gain a feature Milo does not need would be a bad trade.
 *
 * It does not need it because **no step that touches a credential runs in the
 * sandbox.** The three things that need authority all run in the Worker:
 *
 *   1. Snapshot upload to R2   — a binding, so no credential at all
 *   2. Snapshot restore from R2 — a binding, so no credential at all
 *   3. Pushing `agent/<id>` to origin — deliberately NOT done from the sandbox.
 *      Run `milo push` locally with your own git credentials, or upgrade to the
 *      preview and use `outboundByHost`. See README.md > Secrets.
 *
 * Model-provider credentials are the one exception, and they are unavoidable:
 * the harness inside the sandbox has to call the model. They are the user's
 * own keys and OAuth tokens, stored in the AuthVault Durable Object (not in
 * wrangler vars), and injected per session by `src/auth/inject.ts` — as
 * `OPENCODE_AUTH_CONTENT` for OpenCode and `~/.pi/agent/auth.json` for Pi.
 * The GitHub token is never among them.
 */

import { routeAgentRequest } from "agents";
import { Sandbox } from "@cloudflare/sandbox";

import { MiloSession } from "./agent/milo-session.ts";
import { ContainerGate } from "./gate/container-gate.ts";
import { AuthVault } from "./auth/vault.ts";
import { isAuthorized } from "./auth/guard.ts";
import { handleApi } from "./routes/api.ts";
import { writeSnapshot } from "./agent/snapshot.ts";
import type { Env } from "./env.ts";

export { MiloSession, ContainerGate, AuthVault, Sandbox };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // The Agents SDK owns /agents/*. Those routes reach session RPC —
    // launch, run, exec — so when MILO_ADMIN_TOKEN is configured they sit
    // behind the same bearer as the vault, or the gate would be decoration.
    if (url.pathname.startsWith("/agents/") && env.MILO_ADMIN_TOKEN && !isAuthorized(request, env)) {
      return new Response("unauthorized", { status: 401 });
    }
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, ctx);
    }

    if (url.pathname === "/") {
      return Response.json({
        name: "milo",
        tagline: "the friend that minds your agents",
        docs: "https://github.com/kartikkabadi/milo",
        endpoints: ["/api/sessions", "/api/auth/providers", "/api/cost/model", "/api/themes", "/api/harnesses", "/api/health"],
      });
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

/**
 * Re-exported so a future migration to the sandbox preview has one obvious
 * place to add `export { ContainerProxy }`. Unused today, because the stable
 * line has no egress interception to proxy.
 */
export type { Env };
