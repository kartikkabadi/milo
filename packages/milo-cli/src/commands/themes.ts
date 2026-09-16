/**
 * milo themes — install all seven themes for every harness.
 *
 * What it writes, and why each path:
 *
 *   ~/.pi/agent/themes/<id>.json   Pi's global theme directory
 *   .pi/themes/<id>.json           Pi's per-project theme directory
 *   .opencode/themes/milo-greek.json  OpenCode's project theme directory
 *   .opencode/themes/<id>.json
 *   .opencode/tui.json             OpenCode's theme selection
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { c } from "../lib.ts";
import bundle from "../../themes/bundle.json" with { type: "json" };

const PI_THEMES = bundle.pi as Record<string, unknown>;
const OPENCODE_THEMES = bundle.opencode as Record<string, unknown>;
const OPENCODE_GREEK = bundle.opencodeGreek as unknown;

async function writeIfChanged(path: string, contents: string): Promise<"wrote" | "unchanged"> {
  let existing: string | null = null;
  try {
    existing = await readFile(path, "utf8");
  } catch {
    existing = null;
  }
  if (existing === contents) return "unchanged";
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, contents, "utf8");
  return "wrote";
}

export async function themes(args: string[]): Promise<number> {
  const dir = args.find((a) => !a.startsWith("--")) ?? process.cwd();
  const globalOnly = args.includes("--global");
  const projectOnly = args.includes("--project");
  const report = args.includes("--report");

  const piGlobal = resolve(homedir(), ".pi/agent/themes");
  const piProject = resolve(dir, ".pi/themes");
  const ocProject = resolve(dir, ".opencode/themes");

  let wrote = 0;
  let unchanged = 0;

  const targets: [string, string][] = [];

  if (!projectOnly) {
    for (const [id, theme] of Object.entries(PI_THEMES)) {
      targets.push([resolve(piGlobal, `${id}.json`), JSON.stringify(theme, null, 2)]);
    }
  }
  if (!globalOnly) {
    for (const [id, theme] of Object.entries(PI_THEMES)) {
      targets.push([resolve(piProject, `${id}.json`), JSON.stringify(theme, null, 2)]);
    }
    for (const [id, theme] of Object.entries(OPENCODE_THEMES)) {
      targets.push([resolve(ocProject, `${id}.json`), JSON.stringify(theme, null, 2)]);
    }
    targets.push([resolve(ocProject, "milo-greek.json"), JSON.stringify(OPENCODE_GREEK, null, 2)]);
    targets.push([
      resolve(dir, ".opencode/tui.json"),
      JSON.stringify({ $schema: "https://opencode.ai/tui.json", theme: "milo-greek" }, null, 2),
    ]);
  }

  for (const [path, contents] of targets) {
    const result = await writeIfChanged(path, contents);
    if (result === "wrote") {
      wrote++;
      process.stdout.write(`  ${c.green("wrote")}      ${path}\n`);
    } else {
      unchanged++;
    }
  }

  process.stdout.write(`\n  ${wrote} written, ${unchanged} unchanged\n`);

  if (report) {
    process.stdout.write(`\n${c.bold("truecolor check")}\n`);
    const colorterm = process.env.COLORTERM ?? "";
    const ok = colorterm === "truecolor" || colorterm === "24bit";
    process.stdout.write(
      ok
        ? `  ${c.green("ok")}      COLORTERM=${colorterm}\n`
        : `  ${c.yellow("warn")}    COLORTERM=${colorterm || "(unset)"}. these themes are designed for truecolor.\n`,
    );
  }

  process.stdout.write(`\n${c.dim("defaults: Spartan Night (dark), Hellas Marble (light).")}\n`);
  return 0;
}
