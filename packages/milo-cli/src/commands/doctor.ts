/**
 * milo doctor — check the environment before you blame Milo.
 *
 * Every check reports three things: what it looked at, what it found, and what
 * to do about it. A doctor that says "FAIL" without a fix is a doctor that has
 * wasted your time twice.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import { apiBase, c } from "../lib.ts";

const run = promisify(execFile);

type Level = "ok" | "warn" | "fail";

interface Check {
  name: string;
  level: Level;
  detail: string;
  fix?: string;
}

const icon = (level: Level) =>
  level === "ok" ? c.green("ok  ") : level === "warn" ? c.yellow("warn") : c.red("fail");

async function has(command: string): Promise<string | null> {
  try {
    const { stdout } = await run(command, ["--version"]);
    return stdout.trim().split("\n")[0];
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function doctor(args: string[]): Promise<number> {
  const dir = args.find((a) => !a.startsWith("--")) ?? process.cwd();
  const checks: Check[] = [];

  /* Runtime */
  const node = process.version;
  const major = Number(node.replace("v", "").split(".")[0]);
  checks.push({
    name: "node",
    level: major >= 22 ? "ok" : major >= 20 ? "warn" : "fail",
    detail: `${node}${major < 22 ? " (Command Code requires 22 or newer)" : ""}`,
    fix: major < 22 ? "Upgrade Node. Command Code refuses to start on 20 or below." : undefined,
  });

  /* Harnesses */
  for (const [bin, label, required] of [
    ["pi", "Pi", false],
    ["opencode", "OpenCode", false],
    ["cmd", "Command Code", false],
  ] as const) {
    const version = await has(bin);
    checks.push({
      name: label,
      level: version ? "ok" : required ? "fail" : "warn",
      detail: version ?? "not installed",
      fix: version ? undefined : `npm i -g ${bin === "pi" ? "@earendil-works/pi-coding-agent" : bin === "opencode" ? "opencode-ai" : "command-code@latest"}`,
    });
  }

  /* Git, because Milo's persistence is git */
  const git = await has("git");
  checks.push({
    name: "git",
    level: git ? "ok" : "fail",
    detail: git ?? "not installed",
    fix: git ? undefined : "Milo snapshots to git. Without git there is no persistence story.",
  });

  /* Truecolor, because the themes are designed for it */
  const colorterm = process.env.COLORTERM ?? "";
  const truecolor = colorterm === "truecolor" || colorterm === "24bit";
  checks.push({
    name: "truecolor",
    level: truecolor ? "ok" : "warn",
    detail: colorterm || "COLORTERM unset",
    fix: truecolor ? undefined : "Set COLORTERM=truecolor. Without it the seven themes fall back to 16 colours and look like a bug in the theme.",
  });

  /* Rules files */
  for (const file of ["taste.md", "milo.yaml"]) {
    const present = await exists(`${dir}/${file}`);
    checks.push({
      name: file,
      level: present ? "ok" : "warn",
      detail: present ? "present" : "absent",
      fix: present ? undefined : "Optional. Run `milo push` to publish a default set, or `milo pull` to adopt a teammate's.",
    });
  }

  /* The API */
  let apiLevel: Level = "warn";
  let apiDetail = `unreachable at ${apiBase()}`;
  let apiFix: string | undefined = "Start it with `npm run dev:api`, or set MILO_API to a deployed Worker.";
  try {
    const res = await fetch(`${apiBase()}/api/health`, { signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      const body = (await res.json()) as { env?: string };
      apiLevel = "ok";
      apiDetail = `reachable, env=${body.env ?? "unknown"}`;
      apiFix = undefined;
    } else {
      apiLevel = "fail";
      apiDetail = `responded ${res.status}`;
    }
  } catch {
    // Keep the warn above. The API being down is normal before you deploy.
  }
  checks.push({ name: "api", level: apiLevel, detail: apiDetail, fix: apiFix });

  /* Report */
  process.stdout.write(`${c.bold("milo doctor")} ${c.dim(dir)}\n\n`);
  for (const check of checks) {
    process.stdout.write(`  ${icon(check.level)}  ${check.name.padEnd(16)} ${c.dim(check.detail)}\n`);
    if (check.fix && check.level !== "ok") {
      process.stdout.write(`        ${c.dim("-> " + check.fix)}\n`);
    }
  }

  const failures = checks.filter((x) => x.level === "fail").length;
  const warnings = checks.filter((x) => x.level === "warn").length;
  process.stdout.write(
    `\n  ${failures === 0 ? c.green("no blockers") : c.red(`${failures} blocker(s)`)}${warnings ? c.dim(`, ${warnings} warning(s)`) : ""}\n`,
  );
  return failures === 0 ? 0 : 1;
}
