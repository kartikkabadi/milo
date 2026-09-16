/**
 * AuthVault — the credential store.
 *
 * One Durable Object, named "global", holding the user's model-provider
 * credentials. This is what replaces the TUI flows (`opencode /connect`,
 * `pi /login`) and their on-disk files (`~/.local/share/opencode/auth.json`,
 * `~/.pi/agent/auth.json`) — those files assume a laptop, and Milo is a
 * Worker.
 *
 * The rules this class keeps:
 *
 *   1. Secrets never go to the browser. `list()` returns ids, labels, kinds,
 *      and a last-four hint — never a key or a token.
 *   2. Secrets never go to a log. Nothing here is stringified into state or
 *      the transcript; the ledger records counts, not values.
 *   3. Storage is canonical + projected. An entry carries the credential in
 *      each harness's own shape (`entry.pi`, `entry.opencode`), built at store
 *      time by the oauth module or the api-key path. The two harnesses store
 *      OAuth differently (see the Copilot entry — Pi keeps the exchanged
 *      Copilot token, OpenCode keeps the GitHub token), so one blob cannot be
 *      copied across both.
 *   4. Injection happens at run time, scoped to the session's container — see
 *      inject.ts. The vault itself never touches the sandbox.
 *
 * Storage is the DO key-value API, not SQLite: entries are a handful of small
 * JSON blobs keyed `cred:<provider>`, and pending OAuth state is keyed
 * `oauth:<provider>` with a deadline inside the value.
 */

import { DurableObject } from "cloudflare:workers";
import type { Env, HarnessId } from "../env.ts";
import { PROVIDERS, providerSpec } from "./providers.ts";
import { oauthFinish, oauthPoll, oauthStart, type CredBundle, type HarnessCred, type OAuthDisplay, type PendingOAuth } from "./oauth.ts";

interface VaultEntry {
  id: string;
  label: string;
  kind: "api" | "oauth";
  storedAt: number;
  /** Last four characters of the credential. Display only. */
  hint: string;
  pi?: HarnessCred;
  opencode?: HarnessCred;
}

export interface ProviderStatus {
  id: string;
  label: string;
  apiKey: { hint: string } | null;
  oauth: { flow: "device" | "code"; harnesses: HarnessId[]; label: string } | null;
  connected: boolean;
  kind?: "api" | "oauth";
  /** Last-four hint for a connected provider. */
  hint?: string;
  /** Which harnesses a connected credential feeds. */
  feeds?: HarnessId[];
}

const VERSION_KEY = "meta:version";

export class AuthVault extends DurableObject<Env> {
  private async version(): Promise<number> {
    return (await this.ctx.storage.get<number>(VERSION_KEY)) ?? 0;
  }

  private async bump(): Promise<void> {
    await this.ctx.storage.put(VERSION_KEY, (await this.version()) + 1);
  }

  /** The GUI's provider list. Catalog merged with connection state, no secrets. */
  async list(): Promise<ProviderStatus[]> {
    const creds = await this.ctx.storage.get<VaultEntry>(PROVIDERS.map((p) => `cred:${p.id}`));
    return PROVIDERS.map((spec) => {
      const entry = creds.get(`cred:${spec.id}`);
      return {
        id: spec.id,
        label: spec.label,
        apiKey: spec.apiKey,
        oauth: spec.oauth,
        connected: Boolean(entry),
        kind: entry?.kind,
        hint: entry?.hint,
        feeds: entry ? (["pi", "opencode"] as const).filter((h) => entry[h]) : undefined,
      };
    });
  }

  /** Store an API key, projected into both harnesses' auth.json shapes. */
  async setApiKey(id: string, key: string): Promise<{ ok: boolean }> {
    const spec = providerSpec(id);
    if (!spec?.apiKey) return { ok: false };
    const trimmed = key.trim();
    if (trimmed.length < 8) return { ok: false };
    await this.ctx.storage.put(`cred:${id}`, {
      id,
      label: spec.label,
      kind: "api",
      storedAt: Date.now(),
      hint: `…${trimmed.slice(-4)}`,
      pi: { type: "api_key", key: trimmed },
      opencode: { type: "api", key: trimmed },
    } satisfies VaultEntry);
    await this.bump();
    return { ok: true };
  }

  async remove(id: string): Promise<{ ok: boolean }> {
    await this.ctx.storage.delete(`cred:${id}`);
    await this.ctx.storage.delete(`oauth:${id}`);
    await this.bump();
    return { ok: true };
  }

  /**
   * The projection a session injects. Returns only the entries that have a
   * credential for this harness — an Anthropic OAuth entry feeds Pi and does
   * not appear in OpenCode's map, because OpenCode would not know what to do
   * with that shape.
   */
  async project(harness: HarnessId): Promise<{ map: Record<string, HarnessCred>; version: number }> {
    const entries = await this.ctx.storage.list<VaultEntry>({ prefix: "cred:" });
    const map: Record<string, HarnessCred> = {};
    for (const [, entry] of entries) {
      const cred = entry[harness];
      if (cred) map[entry.id] = cred;
    }
    return { map, version: await this.version() };
  }

  /* ---------------------------------------------------------------- *
   * OAuth
   *
   * Pending state lives in `oauth:flow:<flowId>` — per flow, not per
   * provider, so two tabs signing into the same provider cannot clobber
   * each other's verifier or device code. The GUI drives it: start returns
   * a display (device code or URL) plus the flowId every later call needs.
   * ---------------------------------------------------------------- */

  async oauthStart(id: string): Promise<OAuthDisplay & { flowId: string }> {
    const spec = providerSpec(id);
    if (!spec?.oauth) throw new Error(`${id} has no oauth flow`);
    const { pending, display } = await oauthStart(id);
    const flowId = crypto.randomUUID();
    await this.ctx.storage.put(`oauth:flow:${flowId}`, pending);
    return { ...display, flowId };
  }

  /** Poll a device flow once. The GUI calls this on the provider's interval. */
  async oauthPoll(id: string, flowId: string): Promise<{ status: "pending" | "done" | "expired" | "denied"; retryAfter?: number }> {
    const key = `oauth:flow:${flowId}`;
    const pending = await this.ctx.storage.get<PendingOAuth>(key);
    if (!pending || pending.provider !== id) return { status: "denied" };
    const result = await oauthPoll(pending);
    if (result.status === "done") {
      await this.storeBundle(id, result.bundle);
      await this.ctx.storage.delete(key);
      return { status: "done" };
    }
    if (result.status !== "pending") {
      await this.ctx.storage.delete(key);
      return { status: result.status };
    }
    return { status: "pending", retryAfter: result.retryAfter };
  }

  /** Finish a code flow with whatever the user pasted back. */
  async oauthFinish(id: string, flowId: string, input: string): Promise<{ ok: boolean }> {
    const key = `oauth:flow:${flowId}`;
    const pending = await this.ctx.storage.get<PendingOAuth>(key);
    if (!pending || pending.provider !== id) throw new Error(`no pending oauth flow ${flowId} for ${id}`);
    const bundle = await oauthFinish(pending, input);
    await this.storeBundle(id, bundle);
    await this.ctx.storage.delete(key);
    return { ok: true };
  }

  private async storeBundle(id: string, bundle: CredBundle): Promise<void> {
    const spec = providerSpec(id);
    if (!spec) throw new Error(`unknown provider: ${id}`);
    await this.ctx.storage.put(`cred:${id}`, {
      id,
      label: spec.label,
      kind: bundle.kind,
      storedAt: Date.now(),
      hint: bundle.hint,
      pi: bundle.pi,
      opencode: bundle.opencode,
    } satisfies VaultEntry);
    await this.bump();
  }
}
