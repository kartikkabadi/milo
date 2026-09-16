/**
 * Credential injection — the moment a stored credential meets a harness.
 *
 * Each harness reads auth its own way, so injection is per-harness:
 *
 *   Pi        reads ~/.pi/agent/auth.json. We write the file before the run.
 *             A file, not env vars, because it covers OAuth entries too —
 *             env only carries API keys.
 *   OpenCode  prefers OPENCODE_AUTH_CONTENT — a JSON env var that overrides
 *             the file entirely. We set it per exec (it never touches disk)
 *             AND write ~/.local/share/opencode/auth.json so an interactive
 *             `opencode` in the terminal tab is authenticated the same way.
 *
 * The write happens on every inject, not once per version: the container's
 * home directory is ephemeral (snapshots cover /workspace only), so "already
 * written" is not a durable fact. Two sandbox RPCs against an awake container
 * is negligible next to the container-seconds it is about to bill.
 */

import type { Sandbox } from "@cloudflare/sandbox";
import type { Env, HarnessId } from "../env.ts";
import { cmd } from "../agent/snapshot.ts";

const PI_AUTH_PATH = "/home/sandbox/.pi/agent/auth.json";
const OPENCODE_AUTH_PATH = "/home/sandbox/.local/share/opencode/auth.json";

export interface AuthInjection {
  /** Per-exec environment overrides to merge into the RunSpec env. */
  env: Record<string, string>;
  /** How many provider credentials were injected. */
  count: number;
}

export function vaultStub(env: Env) {
  return env.MILO_AUTH.get(env.MILO_AUTH.idFromName("global"));
}

export async function injectHarnessAuth(env: Env, sandbox: Sandbox, harness: HarnessId): Promise<AuthInjection> {
  const { map } = await vaultStub(env).project(harness);
  const count = Object.keys(map).length;
  const envVars: Record<string, string> = {};

  const path = harness === "pi" ? PI_AUTH_PATH : OPENCODE_AUTH_PATH;
  if (count === 0) {
    // An empty projection means every credential was removed. The file must go
    // too, or a warm container keeps using the last credential it was given.
    await sandbox.exec(cmd("rm", "-f", path));
    return { env: envVars, count };
  }
  await sandbox.exec(cmd("mkdir", "-p", path.slice(0, path.lastIndexOf("/"))));
  await sandbox.writeFile(path, JSON.stringify(map, null, 2));
  await sandbox.exec(cmd("chmod", "600", path));

  if (harness === "opencode") {
    envVars.OPENCODE_AUTH_CONTENT = JSON.stringify(map);
  }
  return { env: envVars, count };
}
