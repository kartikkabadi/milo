/**
 * Connect — the provider panel.
 *
 * This replaces the TUI flows: `opencode /connect`, `pi /login`, and the
 * auth.json files they write on a laptop. The list comes from the Worker's
 * AuthVault; a credential saved here reaches the harness inside the sandbox
 * as `OPENCODE_AUTH_CONTENT` or `~/.pi/agent/auth.json` — never through a
 * file the user has to manage.
 *
 * Two shapes of connect:
 *   api key — paste, save, done.
 *   oauth   — device code (GitHub: a code to type on github.com) or a
 *             paste-back code flow (the consent page redirects to a dead
 *             localhost URL; paste it back). The Worker runs the exchanges.
 *
 * The panel never holds a stored credential: it holds the key input while you
 * type it, and the OAuth display while a flow is pending. `hint` is the only
 * trace of a stored credential — the last four characters.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { adminToken, setAdminToken } from "../lib/admin";
import type { OAuthDisplay, ProviderInfo } from "../lib/types";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = adminToken();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    if (res.status === 401) throw new Error("unauthorized — check the admin token below");
    if (res.status === 503) throw new Error(body.error ?? "vault locked — MILO_ADMIN_TOKEN is not set on the Worker");
    throw new Error(body.error ?? `request failed (${res.status})`);
  }
  return body;
}

interface FlowState {
  display: OAuthDisplay;
  error: string | null;
  /** True while a device flow is waiting for the user to finish on github.com. */
  polling: boolean;
}

function ProviderRow({
  provider,
  onChanged,
}: {
  provider: ProviderInfo;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flow, setFlow] = useState<FlowState | null>(null);
  const [paste, setPaste] = useState("");
  const pollTimer = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const saveKey = async () => {
    if (!key.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/auth/providers/${provider.id}`, { method: "PUT", body: JSON.stringify({ key: key.trim() }) });
      setKey("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/auth/providers/${provider.id}`, { method: "DELETE" });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const poll = useCallback(
    async (flowId: string, interval: number) => {
      pollTimer.current = window.setTimeout(async () => {
        try {
          const s = await api<{ status: string; retryAfter?: number }>(
            `/auth/oauth/status?provider=${encodeURIComponent(provider.id)}&flowId=${encodeURIComponent(flowId)}`,
          );
          if (s.status === "done") {
            setFlow(null);
            onChanged();
            return;
          }
          if (s.status === "pending") {
            void poll(flowId, s.retryAfter ?? interval);
            return;
          }
          setFlow((f) => (f ? { ...f, polling: false, error: s.status === "expired" ? "expired — start again" : "denied" } : f));
        } catch (err) {
          setFlow((f) => (f ? { ...f, polling: false, error: String(err instanceof Error ? err.message : err) } : f));
        }
      }, interval * 1000);
    },
    [provider.id, onChanged],
  );

  const startOAuth = async () => {
    setBusy(true);
    setError(null);
    try {
      const display = await api<OAuthDisplay>(`/auth/oauth/start`, {
        method: "POST",
        body: JSON.stringify({ provider: provider.id }),
      });
      setFlow({ display, error: null, polling: display.kind === "device" });
      if (display.kind === "device") void poll(display.flowId, display.interval);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const finishOAuth = async () => {
    if (!paste.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/auth/oauth/finish`, {
        method: "POST",
        body: JSON.stringify({ provider: provider.id, flowId: flow?.display.flowId, input: paste.trim() }),
      });
      setFlow(null);
      setPaste("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded border" style={{ borderColor: "var(--border)" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-[var(--surface-2)]"
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: provider.connected ? "var(--success)" : "var(--border)" }}
          title={provider.connected ? "connected" : "not connected"}
        />
        <span className="flex-1 truncate" style={{ color: provider.connected ? "var(--foreground)" : "var(--muted)" }}>
          {provider.label}
        </span>
        {provider.connected && provider.hint && (
          <span className="mono text-[9px]" style={{ color: "var(--dim)" }}>
            {provider.hint}
          </span>
        )}
        <span className="mono text-[9px] uppercase" style={{ color: "var(--dim)" }}>
          {provider.connected ? provider.kind : provider.oauth ? "oauth" : "key"}
        </span>
      </button>

      {open && (
        <div className="border-t px-2 py-2" style={{ borderColor: "var(--border)" }}>
          {provider.connected && (
            <div className="mb-2 flex items-center justify-between text-[10px]">
              <span style={{ color: "var(--muted)" }}>
                connected{provider.feeds?.length ? ` · feeds ${provider.feeds.join(" + ")}` : ""}
              </span>
              <button type="button" onClick={() => void remove()} disabled={busy} className="underline decoration-dotted" style={{ color: "var(--danger)" }}>
                remove
              </button>
            </div>
          )}

          {provider.apiKey && !flow && (
            <div className="flex gap-1.5">
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={provider.apiKey.hint || "api key"}
                autoComplete="off"
                className="min-w-0 flex-1 rounded border bg-transparent px-2 py-1 text-[11px] outline-none"
                style={{ borderColor: "var(--border)" }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveKey();
                }}
              />
              <button
                type="button"
                onClick={() => void saveKey()}
                disabled={busy || !key.trim()}
                className="rounded px-2 py-1 text-[10px] font-medium disabled:opacity-40"
                style={{ background: "var(--accent)", color: "var(--background)" }}
              >
                save
              </button>
            </div>
          )}

          {provider.oauth && !flow && (
            <div className={provider.apiKey ? "mt-2" : ""}>
              <button
                type="button"
                onClick={() => void startOAuth()}
                disabled={busy}
                className="w-full rounded border px-2 py-1 text-[10px] transition-colors hover:bg-[var(--surface-2)] disabled:opacity-40"
                style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
              >
                sign in — {provider.oauth.label}
              </button>
              {provider.oauth.harnesses.length < 2 && (
                <p className="mt-1 text-[9px]" style={{ color: "var(--dim)" }}>
                  feeds {provider.oauth.harnesses.join(", ")} only
                </p>
              )}
            </div>
          )}

          {flow?.display.kind === "device" && (
            <div className="space-y-2">
              <p className="text-[10px] leading-snug" style={{ color: "var(--muted)" }}>
                Enter this code on GitHub:
              </p>
              <div className="mono rounded border px-2 py-1.5 text-center text-sm tracking-widest" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                {flow.display.userCode}
              </div>
              <a
                href={flow.display.verificationUri}
                target="_blank"
                rel="noreferrer"
                className="block text-center text-[10px] underline decoration-dotted"
                style={{ color: "var(--accent)" }}
              >
                {flow.display.verificationUri}
              </a>
              <p className="text-center text-[9px]" style={{ color: flow.polling ? "var(--dim)" : "var(--warn)" }}>
                {flow.polling ? "waiting for GitHub…" : (flow.error ?? "stopped")}
              </p>
            </div>
          )}

          {flow?.display.kind === "code" && (
            <div className="space-y-2">
              <a
                href={flow.display.url}
                target="_blank"
                rel="noreferrer"
                className="block text-[10px] underline decoration-dotted"
                style={{ color: "var(--accent)" }}
              >
                open the sign-in page
              </a>
              <p className="text-[9px] leading-snug" style={{ color: "var(--dim)" }}>
                {flow.display.instructions}
              </p>
              <textarea
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                rows={2}
                placeholder="paste the redirect URL or code"
                className="w-full resize-none rounded border bg-transparent px-2 py-1 text-[10px] outline-none"
                style={{ borderColor: "var(--border)" }}
              />
              <button
                type="button"
                onClick={() => void finishOAuth()}
                disabled={busy || !paste.trim()}
                className="w-full rounded px-2 py-1 text-[10px] font-medium disabled:opacity-40"
                style={{ background: "var(--accent)", color: "var(--background)" }}
              >
                finish sign-in
              </button>
            </div>
          )}

          {(error ?? flow?.error) && flow?.display.kind !== "device" && (
            <p className="mt-2 text-[9px]" style={{ color: "var(--danger)" }}>
              {error ?? flow?.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function Connect() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(adminToken);

  const refresh = useCallback(async () => {
    try {
      const res = await api<{ providers: ProviderInfo[] }>("/auth/providers");
      setProviders(res.providers);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connected = providers.filter((p) => p.connected).length;

  return (
    <div>
      <h2 className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>
        Providers
      </h2>
      <p className="mt-1 text-[10px]" style={{ color: "var(--muted)" }}>
        Keys and OAuth live in the vault, not a TUI.{" "}
        <span className="mono" style={{ color: connected ? "var(--success)" : "var(--dim)" }}>
          {connected}/{providers.length || "…"} connected
        </span>
      </p>
      <div className="mt-2 space-y-1">
        {providers.map((p) => (
          <ProviderRow key={p.id} provider={p} onChanged={refresh} />
        ))}
      </div>
      <input
        type="password"
        value={token}
        onChange={(e) => {
          setToken(e.target.value);
          setAdminToken(e.target.value);
        }}
        onBlur={() => void refresh()}
        placeholder="admin token (MILO_ADMIN_TOKEN)"
        autoComplete="off"
        className="mt-2 w-full rounded border bg-transparent px-2 py-1 text-[10px] outline-none"
        style={{ borderColor: "var(--border)", color: "var(--muted)" }}
      />
      {error && (
        <p className="mt-2 text-[9px]" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
