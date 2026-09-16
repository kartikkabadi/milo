/** Shared helpers. Small on purpose — a CLI that needs a framework is a CLI
 *  that has forgotten it is a script. */

export const apiBase = (): string => process.env.MILO_API ?? "http://127.0.0.1:8787";

/** ANSI, but only when stdout is a TTY. Piping `milo cost` into a file should
 *  produce a clean file, not one full of escape codes. */
const tty = process.stdout.isTTY === true;
export const c = {
  dim: (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s),
  accent: (s: string) => (tty ? `\x1b[38;2;232;106;31m${s}\x1b[0m` : s),
  green: (s: string) => (tty ? `\x1b[38;2;62;207;142m${s}\x1b[0m` : s),
  red: (s: string) => (tty ? `\x1b[38;2;248;113;113m${s}\x1b[0m` : s),
  yellow: (s: string) => (tty ? `\x1b[38;2;245;158;11m${s}\x1b[0m` : s),
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${apiBase()}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (err) {
    throw new Error(
      `could not reach the Milo API at ${apiBase()}. Start it with \`bun run dev:api\` in the repo, or set MILO_API.\n  ${String(err)}`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status} ${res.statusText}${body ? `\n  ${body}` : ""}`);
  }
  return (await res.json()) as T;
}

export function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  return args[i + 1];
}

export function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      // Skip a flag's value if the next token is not another flag.
      if (args[i + 1] && !args[i + 1].startsWith("--")) i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

export const usd = (n: number, digits = 4): string => `$${n.toFixed(digits)}`;
