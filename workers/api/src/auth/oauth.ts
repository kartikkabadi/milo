/**
 * OAuth, run from the Worker.
 *
 * Neither Pi nor OpenCode's OAuth can run unmodified inside Milo: both assume
 * an interactive terminal and, for browser flows, a localhost callback on the
 * user's machine. A Cloudflare sandbox has neither. So Milo runs the *same*
 * flows headlessly:
 *
 *   device — GitHub's device-code grant. The provider returns a user code and
 *            a URL; the GUI shows them; the Worker polls until the user
 *            completes it. This is byte-identical to what Pi's Copilot login
 *            does, minus the terminal.
 *   code   — PKCE authorize + paste-back. The GUI links out to the consent
 *            page; the provider redirects to a localhost URL that will never
 *            load, and the user pastes that dead URL (or the code it carries)
 *            back into the GUI. Pi supports exactly this as its manual
 *            fallback; the redirect URI below is the same one Pi registers.
 *
 * Endpoints and client ids are taken from the harnesses' own provider
 * implementations — they are public OAuth clients, not Milo secrets.
 */

/* ------------------------------------------------------------------ *
 * Shared shapes
 * ------------------------------------------------------------------ */

export type HarnessCred =
  | { type: "api_key"; key: string }
  | { type: "api"; key: string }
  | { type: "oauth"; access: string; refresh: string; expires: number };

/** What gets persisted in the vault after a flow completes. */
export interface CredBundle {
  kind: "api" | "oauth";
  hint: string;
  pi?: HarnessCred;
  opencode?: HarnessCred;
}

export type PendingOAuth =
  | { provider: string; flow: "device"; deviceCode: string; interval: number; deadline: number }
  | { provider: string; flow: "code"; verifier: string; deadline: number };

export type OAuthDisplay =
  | { kind: "device"; userCode: string; verificationUri: string; interval: number; expiresIn: number }
  | { kind: "code"; url: string; instructions: string };

const OAUTH_TTL_MS = 10 * 60 * 1000;

/* ------------------------------------------------------------------ *
 * PKCE
 * ------------------------------------------------------------------ */

function base64url(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(digest) };
}

/**
 * The user pastes back whatever the provider left them holding: a full
 * redirect URL (`?code=…&state=…`), Claude's `code#state` pair, or a bare
 * code. All three parse to the same thing.
 */
export function parsePastedCode(input: string, fallbackState: string): { code: string; state: string } {
  const t = input.trim();
  try {
    const u = new URL(t);
    const code = u.searchParams.get("code");
    if (code) return { code, state: u.searchParams.get("state") ?? fallbackState };
  } catch {
    // Not a URL. Try the other shapes.
  }
  const hash = t.indexOf("#");
  if (hash > 0) {
    return { code: t.slice(0, hash), state: t.slice(hash + 1) || fallbackState };
  }
  return { code: t, state: fallbackState };
}

/* ------------------------------------------------------------------ *
 * GitHub Copilot — device flow
 *
 * Pi stores `{ access: <exchanged copilot token>, refresh: <github token> }`.
 * OpenCode's plugin stores the GitHub token in both fields with expires 0.
 * The canonical thing the vault keeps is the GitHub token plus the exchanged
 * Copilot token, projected two ways.
 * ------------------------------------------------------------------ */

const COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98";
const COPILOT_HEADERS = {
  "User-Agent": "GitHubCopilotChat/0.35.0",
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": "copilot-chat/0.35.0",
  "Copilot-Integration-Id": "vscode-chat",
  "X-GitHub-Api-Version": "2026-06-01",
};

async function githubDeviceStart(): Promise<{ pending: PendingOAuth; display: OAuthDisplay }> {
  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: COPILOT_CLIENT_ID, scope: "read:user" }),
  });
  if (!res.ok) throw new Error(`github device/code responded ${res.status}`);
  const d = (await res.json()) as {
    device_code: string; user_code: string; verification_uri: string; interval?: number; expires_in?: number;
  };
  return {
    pending: {
      provider: "github-copilot",
      flow: "device",
      deviceCode: d.device_code,
      interval: Math.max(d.interval ?? 5, 5),
      deadline: Date.now() + (d.expires_in ?? 900) * 1000,
    },
    display: {
      kind: "device",
      userCode: d.user_code,
      verificationUri: d.verification_uri,
      interval: Math.max(d.interval ?? 5, 5),
      expiresIn: d.expires_in ?? 900,
    },
  };
}

export type DevicePoll =
  | { status: "pending"; retryAfter: number }
  | { status: "done"; bundle: CredBundle }
  | { status: "expired" | "denied" };

async function githubDevicePoll(pending: Extract<PendingOAuth, { flow: "device" }>): Promise<DevicePoll> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: COPILOT_CLIENT_ID,
      device_code: pending.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const d = (await res.json()) as { access_token?: string; error?: string };
  if (d.access_token) {
    // The Copilot token exchange is what makes this a Copilot credential and
    // not just a GitHub token. Pi needs the exchanged token in `access`;
    // OpenCode does its own exchange at runtime and wants the GitHub token.
    const copilot = await fetch("https://api.github.com/copilot_internal/v2/token", {
      headers: { Authorization: `Bearer ${d.access_token}`, ...COPILOT_HEADERS },
    });
    if (!copilot.ok) throw new Error(`copilot token exchange responded ${copilot.status}`);
    const t = (await copilot.json()) as { token: string; expires_at: number };
    return {
      status: "done",
      bundle: {
        kind: "oauth",
        hint: `…${d.access_token.slice(-4)}`,
        pi: { type: "oauth", access: t.token, refresh: d.access_token, expires: t.expires_at * 1000 - 300_000 },
        opencode: { type: "oauth", access: d.access_token, refresh: d.access_token, expires: 0 },
      },
    };
  }
  if (d.error === "authorization_pending" || d.error === "slow_down") {
    return { status: "pending", retryAfter: pending.interval };
  }
  if (d.error === "expired_token") return { status: "expired" };
  return { status: "denied" };
}

/* ------------------------------------------------------------------ *
 * Anthropic — PKCE authorize + paste-back (Claude Pro/Max, Pi's flow)
 * ------------------------------------------------------------------ */

const ANTHROPIC = {
  authorizeUrl: "https://claude.ai/oauth/authorize",
  tokenUrl: "https://platform.claude.com/v1/oauth/token",
  clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  redirectUri: "http://localhost:53692/callback",
  scope:
    "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
};

function anthropicStart(verifier: string, challenge: string): OAuthDisplay {
  const url =
    `${ANTHROPIC.authorizeUrl}?` +
    new URLSearchParams({
      code: "true",
      client_id: ANTHROPIC.clientId,
      response_type: "code",
      redirect_uri: ANTHROPIC.redirectUri,
      scope: ANTHROPIC.scope,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: verifier,
    }).toString();
  return {
    kind: "code",
    url,
    instructions:
      "Open the link, approve, and the browser will try to reach a localhost URL that never loads. " +
      "Copy that address bar URL — or the code it shows — and paste it back here.",
  };
}

async function anthropicFinish(code: string, state: string, verifier: string): Promise<CredBundle> {
  const res = await fetch(ANTHROPIC.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: ANTHROPIC.clientId,
      code,
      state,
      redirect_uri: ANTHROPIC.redirectUri,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`anthropic token exchange responded ${res.status}`);
  const t = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  const expires = Date.now() + t.expires_in * 1000 - 300_000;
  return {
    kind: "oauth",
    hint: `…${t.access_token.slice(-4)}`,
    pi: { type: "oauth", access: t.access_token, refresh: t.refresh_token, expires },
  };
}

/* ------------------------------------------------------------------ *
 * OpenRouter — PKCE sign-in that mints an ordinary API key
 * ------------------------------------------------------------------ */

const OPENROUTER = {
  authorizeUrl: "https://openrouter.ai/auth",
  tokenUrl: "https://openrouter.ai/api/v1/auth/keys",
  callbackUrl: "http://localhost:53692/callback",
};

function openrouterStart(challenge: string): OAuthDisplay {
  const url =
    `${OPENROUTER.authorizeUrl}?` +
    new URLSearchParams({
      callback_url: OPENROUTER.callbackUrl,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
  return {
    kind: "code",
    url,
    instructions:
      "Open the link and approve. The browser will land on a localhost URL that never loads — " +
      "copy that URL and paste it back here.",
  };
}

async function openrouterFinish(code: string, verifier: string): Promise<CredBundle> {
  const res = await fetch(OPENROUTER.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
  });
  if (!res.ok) throw new Error(`openrouter key exchange responded ${res.status}`);
  const t = (await res.json()) as { key?: string };
  if (!t.key) throw new Error("openrouter exchange returned no key");
  return {
    kind: "api",
    hint: `…${t.key.slice(-4)}`,
    pi: { type: "api_key", key: t.key },
    opencode: { type: "api", key: t.key },
  };
}

/* ------------------------------------------------------------------ *
 * The three entry points the vault calls
 * ------------------------------------------------------------------ */

export async function oauthStart(provider: string): Promise<{ pending: PendingOAuth; display: OAuthDisplay }> {
  if (provider === "github-copilot") return githubDeviceStart();

  const { verifier, challenge } = await pkcePair();
  const pending: PendingOAuth = { provider, flow: "code", verifier, deadline: Date.now() + OAUTH_TTL_MS };
  if (provider === "anthropic") return { pending, display: anthropicStart(verifier, challenge) };
  if (provider === "openrouter") return { pending, display: openrouterStart(challenge) };
  throw new Error(`no oauth flow for ${provider}`);
}

export async function oauthPoll(pending: PendingOAuth): Promise<DevicePoll> {
  if (Date.now() > pending.deadline) return { status: "expired" };
  if (pending.flow !== "device") return { status: "denied" };
  return githubDevicePoll(pending);
}

export async function oauthFinish(pending: PendingOAuth, input: string): Promise<CredBundle> {
  if (Date.now() > pending.deadline) throw new Error("oauth flow expired; start again");
  if (pending.flow !== "code") throw new Error("device flows finish by polling, not by code");
  const { code, state } = parsePastedCode(input, pending.verifier);
  if (!code) throw new Error("no code found in what was pasted");
  // Anthropic binds state to the PKCE verifier, so a pasted state that is not
  // ours is a different flow's paste — refuse it rather than forwarding it.
  if (pending.provider === "anthropic" && state !== pending.verifier) {
    throw new Error("state mismatch — paste the redirect this sign-in produced");
  }
  if (pending.provider === "anthropic") return anthropicFinish(code, state, pending.verifier);
  if (pending.provider === "openrouter") return openrouterFinish(code, pending.verifier);
  throw new Error(`no code flow for ${pending.provider}`);
}
