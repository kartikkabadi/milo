/**
 * The HTTP API. Thin on purpose — the WebSocket path through the Agent carries
 * everything interactive, and these routes exist for curl, the CLI, and the
 * cold-start case where a browser wants a list before it opens a socket.
 */

import type { Env, HarnessId, Tier } from "../env.ts";
import { getHarness, HARNESSES } from "../harness/index.ts";
import { vaultStub } from "../auth/inject.ts";
import { THEMES } from "./themes.ts";
import { includedContainerHours, priceScenario } from "../cost/model.ts";
import { INSTANCE_TYPES } from "../cost/rates.ts";

const json = (data: unknown, init: ResponseInit = {}): Response =>
  Response.json(data, {
    ...init,
    headers: { "cache-control": "no-store", ...(init.headers ?? {}) },
  });

const bad = (message: string, status = 400): Response => json({ error: message }, { status });

/**
 * Resolve a session's Durable Object stub.
 *
 * `idFromName` is a pure hash of the name, so the same session id always lands
 * on the same object from any colo. There is no registry to keep consistent.
 */
function sessionStub(env: Env, id: string) {
  return env.MILO_SESSION.get(env.MILO_SESSION.idFromName(id));
}

export async function handleApi(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, "");
  const method = request.method;

  /* ---------------------------------------------------------------- *
   * Health and metadata
   * ---------------------------------------------------------------- */

  if (path === "/health") {
    return json({ ok: true, env: env.MILO_ENV ?? "unknown", ts: Date.now() });
  }

  if (path === "/harnesses" && method === "GET") {
    return json({
      harnesses: Object.values(HARNESSES).map((h) => ({
        id: h.id,
        label: h.label,
        allowedTiers: h.allowedTiers,
        note:
          h.id === "pi"
            ? "Runs in every tier. The only harness that can genuinely work without a filesystem."
            : "Plan/Explore/Scout are read-only and stay in Tiers 0-1. Build is Tier 3 only.",
      })),
    });
  }

  if (path === "/themes" && method === "GET") {
    return json({ themes: THEMES });
  }

  /* ---------------------------------------------------------------- *
   * Provider auth — the GUI's Connect panel
   *
   * Secrets only ever travel browser -> Worker -> vault/sandbox. The
   * browser-facing surface returns provider metadata, OAuth display
   * instructions, and last-four hints — never a credential value.
   * ---------------------------------------------------------------- */

  if (path === "/auth/providers" && method === "GET") {
    return json({ providers: await vaultStub(env).list() });
  }

  const providerMatch = /^\/auth\/providers\/([A-Za-z0-9_-]{1,64})$/.exec(path);
  if (providerMatch) {
    const id = providerMatch[1];
    const vault = vaultStub(env);
    if (method === "PUT") {
      const body = (await request.json().catch(() => ({}))) as { key?: string };
      if (!body.key) return bad("key is required");
      const res = await vault.setApiKey(id, body.key);
      return res.ok ? json(res) : bad(`${id} does not take an API key, or the key was rejected`, 422);
    }
    if (method === "DELETE") {
      return json(await vault.remove(id));
    }
    return bad("method not allowed", 405);
  }

  if (path === "/auth/oauth/start" && method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { provider?: string };
    if (!body.provider) return bad("provider is required");
    try {
      return json(await vaultStub(env).oauthStart(body.provider));
    } catch (err) {
      return bad(err instanceof Error ? err.message : String(err));
    }
  }

  if (path === "/auth/oauth/finish" && method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { provider?: string; input?: string };
    if (!body.provider) return bad("provider is required");
    if (!body.input) return bad("input is required — the pasted redirect URL or code");
    try {
      return json(await vaultStub(env).oauthFinish(body.provider, body.input));
    } catch (err) {
      return bad(err instanceof Error ? err.message : String(err));
    }
  }

  if (path === "/auth/oauth/status" && method === "GET") {
    const provider = url.searchParams.get("provider");
    if (!provider) return bad("provider is required");
    return json(await vaultStub(env).oauthPoll(provider));
  }

  /* ---------------------------------------------------------------- *
   * Cost
   * ---------------------------------------------------------------- */

  if (path === "/cost/model" && method === "GET") {
    const hours = Number(url.searchParams.get("agentHours") ?? "3000");
    const duty = Number(url.searchParams.get("tier3Duty") ?? "0.179");
    const instanceType = url.searchParams.get("instance") ?? "lite";

    if (!INSTANCE_TYPES[instanceType]) return bad(`unknown instance: ${instanceType}`);
    if (!Number.isFinite(hours) || hours < 0) return bad("agentHours must be a positive number");
    if (!Number.isFinite(duty) || duty < 0 || duty > 1) return bad("tier3Duty must be between 0 and 1");

    const priced = priceScenario({
      name: "api",
      note: "",
      instanceType,
      agentHours: hours,
      tier3Duty: duty,
      cpuBusyFraction: 0.85,
      doSecondsPerAgentHour: 24,
      doRequests: 600_000,
      r2ClassA: 60_000,
      r2ClassB: 120_000,
      r2StorageGbMonth: 2,
      workerRequests: 400_000,
      workerCpuMs: 2_000_000,
    });

    return json({
      instanceType,
      agentHours: hours,
      tier3Duty: duty,
      containerHours: priced.containerHours,
      includedContainerHours: includedContainerHours(INSTANCE_TYPES[instanceType]).hours,
      usd: {
        base: priced.base,
        containerMemory: priced.container.memory.usd,
        containerDisk: priced.container.disk.usd,
        containerCpu: priced.container.cpu.usd,
        durableObjects: priced.durableObjects.usd,
        workers: priced.workers.usd,
        r2: priced.r2.usd,
        overage: priced.overage,
        total: priced.total,
      },
    });
  }

  /* ---------------------------------------------------------------- *
   * Sessions
   * ---------------------------------------------------------------- */

  if (path === "/sessions" && method === "GET") {
    // Sessions are discovered from the gate plus the caller's own ids. There is
    // no global registry on purpose: a registry is a single point of cost and
    // failure, and the GUI already knows which sessions it opened.
    const gate = env.CONTAINER_GATE.get(env.CONTAINER_GATE.idFromName("fleet"));
    const status = await gate.status();
    return json({ gate: status, hint: "sessions are addressed by id; GET /api/sessions/:id" });
  }

  const sessionMatch = /^\/sessions\/([A-Za-z0-9_-]{1,64})(\/.*)?$/.exec(path);
  if (sessionMatch) {
    const [, id, rest = ""] = sessionMatch;
    const stub = sessionStub(env, id);

    if (rest === "" && method === "GET") {
      const res = await stub.fetch(new Request("https://session.internal/health"));
      return json(await res.json());
    }

    if (rest === "/cost" && method === "GET") {
      return json(await stub.cost());
    }

    if (rest === "/timeline" && method === "GET") {
      return json({ timeline: await stub.timeline() });
    }

    if (rest === "/approvals" && method === "GET") {
      return json({ approvals: await stub.pendingApprovals() });
    }

    if (rest === "/approvals" && method === "POST") {
      const body = (await request.json()) as { id?: string; decision?: string; resolvedBy?: string };
      if (!body.id) return bad("id is required");
      if (body.decision !== "allow" && body.decision !== "deny" && body.decision !== "ask") {
        return bad("decision must be allow, ask, or deny");
      }
      return json(await stub.resolveApproval(body.id, body.decision, body.resolvedBy));
    }

    if (rest === "/run" && method === "POST") {
      const body = (await request.json()) as { tier?: number; prompt?: string };
      if (typeof body.tier !== "number" || ![0, 1, 2, 3].includes(body.tier)) {
        return bad("tier must be 0, 1, 2, or 3");
      }
      if (!body.prompt) return bad("prompt is required");
      try {
        return json(await stub.run(body.tier as Tier, body.prompt));
      } catch (err) {
        return bad(String(err), 409);
      }
    }

    if (rest === "/launch" && method === "POST") {
      const body = (await request.json()) as { harness?: string; repo?: string; model?: string };
      if (!body.harness) return bad("harness is required");
      try {
        getHarness(body.harness as HarnessId);
      } catch {
        return bad(`unknown harness: ${body.harness}`);
      }
      if (!body.repo) return bad("repo is required");
      return json(await stub.launch({ harness: body.harness as HarnessId, repo: body.repo, model: body.model }));
    }

    if (rest === "/sleep" && method === "POST") {
      return json(await stub.sleep("api"));
    }

    if (rest === "/wake" && method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { repoUrl?: string };
      return json(await stub.wake(body));
    }

    if (rest === "/fork" && method === "POST") {
      const body = (await request.json()) as { sha?: string };
      if (!body.sha) return bad("sha is required");
      return json(await stub.fork(body.sha));
    }

    if (rest === "/model" && method === "POST") {
      const body = (await request.json()) as { model?: string };
      if (!body.model) return bad("model is required");
      return json(await stub.setModel(body.model));
    }

    return bad("not found", 404);
  }

  return bad("not found", 404);
}
