/**
 * milo push / milo pull — watch rules.
 *
 * `taste.md` is prose rules in plain language. `milo.yaml` is the machine half.
 * Both travel together, because a rule that says "ask before deleting a
 * migration" is useless if the machine half does not know which paths that
 * means.
 *
 * Push and pull are git operations on a `milo-rules` branch, not a Milo
 * service. There is no Milo server, so rules move the way everything else in
 * this repo moves: through the remote you already have.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { c } from "../lib.ts";

const run = promisify(execFile);

const RULES_BRANCH = "milo-rules";
const FILES = ["taste.md", "milo.yaml"] as const;

const DEFAULT_TASTE = `# taste.md

Prose rules for the agent. Plain language, no schema. Milo reads this as
context, and the machine half in milo.yaml decides what is actually enforced.

- Never force-push. Commit a wip(agent) and leave the diff.
- Ask before deleting a branch, a migration, or anything in .github/.
- Prefer the smallest diff that makes the test pass.
- Run the fast suite on every save. Run the full suite before you sleep.
- If a test was already failing, say so and stop. Do not fix it.
- Never edit a lockfile by hand.
`;

const DEFAULT_YAML = `# milo.yaml

wake:
  on:
    - ci.failed
    - pr.review_requested
    - schedule: "0 3 * * *"
  maxTier: 3
  maxWakeMs: 120000

touch:
  allow: ["src/**", "test/**", "docs/**"]
  ask:   ["package.json", "**/*.sql", ".github/**"]
  deny:  [".env*", "**/*.pem", "secrets/**"]

sleep:
  afterIdleSeconds: 30
  snapshot: git        # never a VM image
  keepNodeModules: false
  ttlSeconds: 604800
`;

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await run("git", args, { cwd });
  return stdout.trim();
}

async function root(dir: string): Promise<string> {
  try {
    return await git(["rev-parse", "--show-toplevel"], dir);
  } catch {
    throw new Error(`${dir} is not inside a git repository.`);
  }
}

export async function push(args: string[]): Promise<number> {
  const dir = args.find((a) => !a.startsWith("--")) ?? process.cwd();
  const repo = await root(dir);

  // Write the defaults if the files are absent, so `milo push` on a fresh repo
  // publishes something real rather than an empty branch.
  for (const [name, contents] of [
    ["taste.md", DEFAULT_TASTE],
    ["milo.yaml", DEFAULT_YAML],
  ] as const) {
    const path = resolve(repo, name);
    try {
      await readFile(path, "utf8");
    } catch {
      await writeFile(path, contents, "utf8");
      process.stdout.write(`  ${c.green("created")}   ${name}\n`);
    }
  }

  const original = await git(["rev-parse", "--abbrev-ref", "HEAD"], repo);
  process.stdout.write(`${c.dim("  on")}        ${original}\n`);

  // A throwaway worktree would be cleaner, but rules files are small and this
  // keeps the operation reversible in one command.
  await git(["checkout", "-B", RULES_BRANCH], repo);
  await git(["add", ...FILES], repo);
  try {
    await git(["commit", "-m", `rules: publish watch rules ${new Date().toISOString()}`], repo);
    process.stdout.write(`  ${c.green("committed")} ${RULES_BRANCH}\n`);
  } catch {
    process.stdout.write(`  ${c.dim("nothing to commit; the rules are unchanged")}\n`);
  }

  try {
    await git(["push", "-u", "origin", RULES_BRANCH], repo);
    process.stdout.write(`  ${c.green("pushed")}    origin/${RULES_BRANCH}\n`);
  } catch (err) {
    process.stderr.write(`  ${c.yellow("could not push")} ${String(err instanceof Error ? err.message : err)}\n`);
    process.stderr.write(`  ${c.dim("the commit is local. push it yourself when the remote is reachable.")}\n`);
  }

  await git(["checkout", original], repo);
  process.stdout.write(`  ${c.dim("back on")}    ${original}\n`);
  return 0;
}

export async function pull(args: string[]): Promise<number> {
  const dir = args.find((a) => !a.startsWith("--")) ?? process.cwd();
  const repo = await root(dir);

  try {
    await git(["fetch", "origin", RULES_BRANCH], repo);
  } catch {
    process.stderr.write(
      `${c.yellow("no rules on origin yet.")} Run \`milo push\` somewhere first, or check the branch name (${RULES_BRANCH}).\n`,
    );
    return 1;
  }

  const files: string[] = [];
  for (const name of FILES) {
    try {
      const contents = await git(["show", `FETCH_HEAD:${name}`], repo);
      await mkdir(resolve(repo, "."), { recursive: true });
      await writeFile(resolve(repo, name), contents + "\n", "utf8");
      files.push(name);
    } catch {
      // Not every ruleset carries both files. Absent is not an error.
    }
  }

  if (files.length === 0) {
    process.stderr.write(`${c.yellow("fetched the branch, but it carries neither taste.md nor milo.yaml.")}\n`);
    return 1;
  }

  process.stdout.write(`${c.green("pulled")} ${files.join(", ")} from origin/${RULES_BRANCH}\n`);
  process.stdout.write(`${c.dim("review them before you let an agent run: these are instructions.")}\n`);
  return 0;
}
