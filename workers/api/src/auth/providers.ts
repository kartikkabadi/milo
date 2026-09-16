/**
 * The provider catalog.
 *
 * This is the GUI's `/connect` list — the same idea as `opencode /connect` or
 * Pi's `/login`, except the list lives in Milo and the credentials live in the
 * AuthVault Durable Object instead of a TUI-owned file on a laptop.
 *
 * One catalog entry can offer two ways in:
 *
 *   apiKey — the user pastes a key. Works for every provider on both
 *            harnesses, projected as Pi `api_key` and OpenCode `api`.
 *   oauth  — a subscription sign-in. Two shapes exist in the wild:
 *            `device` (GitHub shows a code, you type it on github.com) and
 *            `code` (browser consent, then paste the redirect back). The
 *            `harnesses` list says which adapters the resulting credential is
 *            projected into — the two harnesses do not store OAuth the same
 *            way, so a provider is only listed for a harness when its shape
 *            is known to work there.
 *
 * Provider ids are the canonical ones both harnesses already use:
 * `anthropic`, `openai`, `google`, … `github-copilot`. Pi keys auth.json by
 * them and OpenCode keys auth.json by the models.dev id, which for this set
 * is the same string.
 */

import type { HarnessId } from "../env.ts";

export interface ProviderSpec {
  id: string;
  label: string;
  apiKey: { hint: string } | null;
  oauth: { flow: "device" | "code"; harnesses: HarnessId[]; label: string } | null;
}

export const PROVIDERS: ProviderSpec[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    apiKey: { hint: "sk-ant-…" },
    // Claude Pro/Max subscription. Pi supports it; OpenCode's own Anthropic
    // plugin stores a different shape, so this flow feeds Pi only. OpenCode
    // users take the API-key path.
    oauth: { flow: "code", harnesses: ["pi"], label: "Claude Pro/Max subscription" },
  },
  {
    id: "openai",
    label: "OpenAI",
    apiKey: { hint: "sk-…" },
    // Codex OAuth exists in both harnesses but stores different shapes
    // (OpenCode keeps an accountId). API key until that projection exists.
    oauth: null,
  },
  { id: "google", label: "Google", apiKey: { hint: "AIza…" }, oauth: null },
  { id: "xai", label: "xAI", apiKey: { hint: "xai-…" }, oauth: null },
  {
    id: "openrouter",
    label: "OpenRouter",
    apiKey: { hint: "sk-or-…" },
    // PKCE sign-in that mints an ordinary API key, so it projects to both.
    oauth: { flow: "code", harnesses: ["pi", "opencode"], label: "browser sign-in" },
  },
  { id: "deepseek", label: "DeepSeek", apiKey: { hint: "sk-…" }, oauth: null },
  { id: "groq", label: "Groq", apiKey: { hint: "gsk_…" }, oauth: null },
  { id: "mistral", label: "Mistral", apiKey: { hint: "…" }, oauth: null },
  {
    id: "github-copilot",
    label: "GitHub Copilot",
    apiKey: null,
    oauth: { flow: "device", harnesses: ["pi", "opencode"], label: "GitHub device code" },
  },
];

export function providerSpec(id: string): ProviderSpec | null {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}
