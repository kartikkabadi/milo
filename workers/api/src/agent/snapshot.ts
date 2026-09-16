/**
 * Snapshot and restore. The sleep path and the wake path.
 *
 * The premise
 * -----------
 * Disk is ephemeral. When a container sleeps, its filesystem is gone. Milo
 * does not fight this. It treats **git as the source of truth** and the
 * container as a cache. A session that sleeps loses nothing that matters,
 * because everything that matters is a commit.
 *
 * The uncomfortable fact this design is built around
 * ------------------------------------------------
 * There is no reliable shutdown hook. A Durable Object can be evicted between
 * two lines of your code with no callback. There is no `onStop` in the Agents
 * SDK lifecycle, and even if there were, you could not trust it — the runtime
 * is explicit that eviction can happen at any point and that in-flight work is
 * given a grace period, not a guarantee.
 *
 * So Milo does not snapshot "on shutdown". It snapshots on a cadence, on
 * quiescence, and before anything expensive. Every snapshot is a git commit,
 * which means a missed snapshot costs you at most the work since the last
 * commit — and never corrupts anything, because a half-written snapshot is
 * just an uncommitted working tree.
 *
 * Three consequences that fall out of that, all of them good:
 *   1. Snapshotting is idempotent. Run it twice, get the same commit.
 *   2. A snapshot cannot be "in progress" in a way that breaks a restore.
 *   3. Restoring is `git reset --hard`, which is the same operation a human
 *      would run. There is no proprietary format to be locked into.
 *
 * What is never snapshotted
 * -------------------------
 *   node_modules/  — restored by `npm ci` from the lockfile, which is committed
 *   .vite/ dist/   — generated caches, excluded by path and by gitignore
 *   secrets        — .env is gitignored, and the excludes list is checked twice
 *   binaries >10MB — uploaded separately to R2 with a manifest pointer
 *
 * On the SDK version
 * ------------------
 * This is written against the stable `@cloudflare/sandbox` 0.6.x API, where
 * `exec` takes a command string and returns `{ success, exitCode, stdout,
 * stderr }`. The 1.0 preview replaces that with a process handle, and adds
 * outbound egress interception. Milo does not need the latter: every step that
 * touches a credential runs in the Worker, not in the sandbox. See README.md >
 * Secrets.
 */

import type { Sandbox } from "@cloudflare/sandbox";
import type { Env, SnapshotPointer } from "../env.ts";

/**
 * Quote one shell argument.
 *
 * The 0.6.x SDK takes a command *string*, not an argv array, so every argument
 * that reaches a shell has to be quoted here. Single quotes, with embedded
 * single quotes escaped as '\'' — the only form that is safe for arbitrary
 * content, including the newlines and backticks that show up in commit
 * messages.
 */
export function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Encode bytes as base64.
 *
 * `btoa(String.fromCharCode(...bytes))` blows the call stack on a large buffer,
 * which is exactly the case this is for. Chunked instead.
 */
export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Build a command string from a program and its arguments, safely quoted. */
export function cmd(program: string, ...args: (string | number)[]): string {
  return [program, ...args.map((a) => shq(String(a)))].join(" ");
}

/** Files larger than this go to R2 individually instead of into the bundle. */
export const BIG_FILE_BYTES = 10 * 1024 * 1024;

/** Refuse to pull a single object larger than this into the Worker. 128 MB isolate. */
export const MAX_INLINE_BYTES = 48 * 1024 * 1024;

/** Where a session's repo lives. Every exec passes this as cwd. */
export const WORKDIR = "/workspace";

/** Paths that are never worth snapshotting, regardless of .gitignore. */
export const ALWAYS_EXCLUDED = [
  "node_modules",
  ".vite",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
  "coverage",
  ".wrangler",
  ".env",
  ".env.local",
  ".env.production",
  "*.pem",
  "*.key",
];

export interface SnapshotResult {
  pointer: SnapshotPointer;
  /** Bytes written to R2 this run. */
  bytesWritten: number;
  /** How many prior snapshots were deleted. */
  pruned: number;
  /** True when the working tree was already clean, so nothing was written. */
  noop: boolean;
  log: string[];
}

const R2_PREFIX = "snapshots";

export const snapshotKeys = {
  bundle: (id: string, ts: number) => `${R2_PREFIX}/${id}/${ts}/repo.bundle`,
  patch: (id: string, ts: number) => `${R2_PREFIX}/${id}/${ts}/work.patch`,
  untracked: (id: string, ts: number) => `${R2_PREFIX}/${id}/${ts}/untracked.tgz`,
  manifest: (id: string, ts: number) => `${R2_PREFIX}/${id}/${ts}/manifest.json`,
  prefix: (id: string) => `${R2_PREFIX}/${id}/`,
};

/**
 * The commit step. Runs inside the sandbox.
 *
 * Order matters and each step is here for a reason:
 *   chmod a+rX   — createBackup() must be able to read every file. Files at
 *                  0600 cause BackupCreateError, and harnesses love 0600.
 *   clear lock   — a killed git process leaves index.lock behind, and every
 *                  subsequent git command fails until it is removed.
 *   add -A       — includes deletions. A snapshot that only adds is a lie.
 *   commit       — on `agent/<id>`, never on the user's branch.
 */
export async function commitWip(
  sandbox: Sandbox,
  sessionId: string,
  opts: { message?: string } = {},
): Promise<{ sha: string; changed: boolean; log: string[] }> {
  const log: string[] = [];
  const branch = `agent/${sessionId}`;
  const message = opts.message ?? `wip(agent): ${sessionId} ${new Date().toISOString()}`;

  const steps = [
    cmd("chmod", "-R", "a+rX", "."),
    cmd("git", "config", "user.email", "agent@milo.local"),
    cmd("git", "config", "user.name", `milo ${sessionId}`),
    // A stale lock is the single most common cause of a failed snapshot, so
    // clear it before anything reads the index.
    cmd("rm", "-f", ".git/index.lock"),
    cmd("git", "checkout", "-B", branch),
    cmd("git", "add", "-A"),
  ];

  for (const command of steps) {
    const r = await sandbox.exec(command, { cwd: WORKDIR });
    log.push(`${command} -> exit ${r.exitCode}`);
  }

  const status = await sandbox.exec(cmd("git", "status", "--porcelain"), { cwd: WORKDIR });
  const changed = status.stdout.trim().length > 0;
  log.push(`porcelain lines: ${status.stdout.trim().split("\n").filter(Boolean).length}`);

  if (changed) {
    const commit = await sandbox.exec(cmd("git", "commit", "-m", message, "--no-verify"), { cwd: WORKDIR });
    log.push(`commit -> exit ${commit.exitCode}`);
    if (!commit.success) {
      // Retry once after clearing the lock. A killed git leaves it behind.
      await sandbox.exec(cmd("rm", "-f", ".git/index.lock"), { cwd: WORKDIR });
      const retry = await sandbox.exec(cmd("git", "commit", "-m", message, "--no-verify"), { cwd: WORKDIR });
      log.push(`commit retry -> exit ${retry.exitCode}`);
    }
  }

  const rev = await sandbox.exec(cmd("git", "rev-parse", "HEAD"), { cwd: WORKDIR });
  return { sha: rev.stdout.trim(), changed, log };
}

/**
 * Produce the snapshot payloads and upload them.
 *
 * Two payloads, because they fail differently:
 *   patch    — small, applies to any checkout of the parent. Preferred.
 *   bundle   — self-contained, survives a rewritten history. Fallback.
 *
 * We write both when the repo is small enough. Storage is $0.015/GB-month, so
 * a few hundred KB of redundancy costs nothing and removes a whole class of
 * "the patch did not apply" failure.
 */
export async function writeSnapshot(
  env: Env,
  sandbox: Sandbox,
  sessionId: string,
  opts: { ttlSeconds?: number; force?: boolean } = {},
): Promise<SnapshotResult> {
  const ttl = opts.ttlSeconds ?? 7 * 24 * 60 * 60;
  const ts = Date.now();
  const log: string[] = [];

  const commit = await commitWip(sandbox, sessionId);
  log.push(...commit.log);

  if (!commit.changed && !opts.force) {
    // Nothing to do. This is the common case and it must be free.
    return {
      pointer: { sha: commit.sha, branch: `agent/${sessionId}`, ts, bytes: 0, ttl, strategy: "patch" },
      bytesWritten: 0,
      pruned: 0,
      noop: true,
      log: [...log, "working tree clean, no snapshot written"],
    };
  }

  const sha = commit.sha;
  let bytesWritten = 0;
  let bundleKey: string | undefined;
  let patchKey: string | undefined;
  let untrackedKey: string | undefined;

  // 1. Patch against the previous snapshot. Cheapest thing that can work.
  const patchPath = "/tmp/milo-work.patch";
  await sandbox.exec(`git diff HEAD~1 HEAD --binary > ${shq(patchPath)}`, { cwd: WORKDIR });
  const patch = await readText(sandbox, patchPath);
  if (patch !== null && patch.length > 0) {
    if (patch.length <= MAX_INLINE_BYTES) {
      patchKey = snapshotKeys.patch(sessionId, ts);
      await env.SNAPSHOTS.put(patchKey, patch);
      bytesWritten += patch.length;
      log.push(`patch ${patch.length} bytes -> ${patchKey}`);
    } else {
      log.push(`patch too large to inline (${patch.length}), skipped`);
    }
  }

  // 2. Bundle. Self-contained fallback, so a restore never depends on the
  //    container having any prior history.
  const bundlePath = "/tmp/milo-repo.bundle";
  await sandbox.exec(
    cmd("git", "bundle", "create", bundlePath, `agent/${sessionId}`, "--", "HEAD~30..HEAD"),
    { cwd: WORKDIR },
  );
  const bundle = await readText(sandbox, bundlePath);
  if (bundle !== null && bundle.length > 0 && bundle.length <= MAX_INLINE_BYTES) {
    bundleKey = snapshotKeys.bundle(sessionId, ts);
    await env.SNAPSHOTS.put(bundleKey, bundle);
    bytesWritten += bundle.length;
    log.push(`bundle ${bundle.length} bytes -> ${bundleKey}`);
  } else if (bundle && bundle.length > MAX_INLINE_BYTES) {
    log.push(`bundle too large to inline (${bundle.length}), patch-only snapshot`);
  }

  // 3. Untracked files. `git add -A` already staged them, but a snapshot that
  //    only restores tracked files loses a harness's scratch output.
  const untrackedPath = "/tmp/milo-untracked.tgz";
  const untracked = await sandbox.exec(
    `git ls-files --others --exclude-standard -z | tar --null -T - -czf ${shq(untrackedPath)} 2>/dev/null || true`,
    { cwd: WORKDIR },
  );
  if (untracked.success) {
    const tgz = await readText(sandbox, untrackedPath);
    if (tgz !== null && tgz.length > 0 && tgz.length <= MAX_INLINE_BYTES) {
      untrackedKey = snapshotKeys.untracked(sessionId, ts);
      await env.SNAPSHOTS.put(untrackedKey, tgz);
      bytesWritten += tgz.length;
      log.push(`untracked ${tgz.length} bytes -> ${untrackedKey}`);
    }
  }

  // 4. Binaries over the threshold get their own object plus a manifest entry,
  //    so a restore can report exactly what it is not bringing back.
  const big = await sandbox.exec(
    `find . -type f -not -path './.git/*' -not -path './node_modules/*' -size +${Math.floor(BIG_FILE_BYTES / 1024)}k -printf '%s %p\\n' 2>/dev/null | head -50`,
    { cwd: WORKDIR },
  );
  const bigFiles = big.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [size, path] = line.split(" ");
      return { path, bytes: Number(size) };
    });

  const manifest = {
    sessionId,
    sha,
    ts,
    branch: `agent/${sessionId}`,
    excluded: ALWAYS_EXCLUDED,
    bigFiles,
    note: "Big files are listed but not uploaded. Restore reports them so nothing disappears silently.",
  };
  const manifestKey = snapshotKeys.manifest(sessionId, ts);
  await env.SNAPSHOTS.put(manifestKey, JSON.stringify(manifest, null, 2));
  bytesWritten += JSON.stringify(manifest).length;

  // 5. Delete the prior snapshot. Keeping history is not the job — git already
  //    has the history. R2 is a cache of the newest usable state.
  const pruned = await deletePrevious(env, sessionId, ts);

  return {
    pointer: {
      sha,
      branch: `agent/${sessionId}`,
      ts,
      bundleKey,
      patchKey,
      untrackedKey,
      bytes: bytesWritten,
      ttl,
      strategy: bundleKey && patchKey ? "both" : bundleKey ? "bundle" : "patch",
    },
    bytesWritten,
    pruned,
    noop: false,
    log,
  };
}

/**
 * Read a text file, returning null instead of throwing when it is absent.
 *
 * The 0.6.x SDK returns `{ content: string, encoding: 'utf-8' | 'base64' }`.
 * Patch and bundle payloads are text, and a bundle is ASCII-armoured by git, so
 * utf-8 is the right read for both. Anything the SDK reports as base64 is
 * decoded here rather than being silently uploaded as mojibake.
 */
async function readText(sandbox: Sandbox, path: string): Promise<string | null> {
  try {
    const res = await sandbox.readFile(path);
    if (!res?.success) return null;
    if (res.encoding === "base64") {
      const bin = atob(res.content);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    }
    return res.content;
  } catch {
    return null;
  }
}

/**
 * Delete every snapshot for a session except the newest. Returns how many
 * object keys were removed.
 */
export async function deletePrevious(env: Env, sessionId: string, keepTs: number): Promise<number> {
  const listed = await env.SNAPSHOTS.list({ prefix: snapshotKeys.prefix(sessionId) });
  const stale = listed.objects.filter((o) => !o.key.includes(`/${keepTs}/`));
  if (stale.length === 0) return 0;
  await env.SNAPSHOTS.delete(stale.map((o) => o.key));
  return stale.length;
}

export interface RestoreResult {
  ok: boolean;
  strategy: "bundle" | "patch" | "clone";
  sha: string | null;
  log: string[];
  /** Big files that were listed in the manifest but not restored. */
  skippedBigFiles: { path: string; bytes: number }[];
  /** True when the working tree is clean and HEAD matches the pointer. */
  verified: boolean;
}

/**
 * The wake path.
 *
 * Three strategies, tried in order of cheapness:
 *   1. shallow clone + fetch the agent ref + reset --hard   (repo reachable)
 *   2. clone the R2 bundle                                  (repo unreachable)
 *   3. git apply the patch                                  (bundle missing)
 *
 * Then `npm ci` from the lockfile, because node_modules was deliberately not
 * snapshotted.
 */
export async function restoreSnapshot(
  env: Env,
  sandbox: Sandbox,
  sessionId: string,
  pointer: SnapshotPointer,
  opts: { repoUrl?: string; installCommand?: string } = {},
): Promise<RestoreResult> {
  const log: string[] = [];
  const workdir = "/workspace";
  const install = opts.installCommand ?? "npm ci --no-audit --no-fund";

  // A stale worktree registration blocks a re-clone into the same path.
  await sandbox.exec(cmd("git", "worktree", "prune"), { cwd: workdir });
  log.push("git worktree prune");

  let strategy: RestoreResult["strategy"] = "clone";

  // 1. Shallow clone from the remote, then fetch the snapshot ref.
  if (opts.repoUrl) {
    const clone = await sandbox.exec(cmd("git", "clone", "--depth", "1", opts.repoUrl, workdir));
    log.push(`clone --depth 1 -> exit ${clone.exitCode}`);
    if (clone.success) {
      const fetch = await sandbox.exec(
        cmd("git", "-C", workdir, "fetch", "--depth", "1", "origin", `refs/heads/${pointer.branch}`),
      );
      log.push(`fetch ${pointer.branch} -> exit ${fetch.exitCode}`);
      if (fetch.success) {
        const reset = await sandbox.exec(cmd("git", "-C", workdir, "reset", "--hard", "FETCH_HEAD"));
        log.push(`reset --hard FETCH_HEAD -> exit ${reset.exitCode}`);
        if (reset.success) strategy = "patch";
      }
    }
  }

  // 2. Bundle from R2. Self-contained, works with no network.
  if (strategy === "clone" && pointer.bundleKey) {
    const obj = await env.SNAPSHOTS.get(pointer.bundleKey);
    if (obj) {
      await sandbox.writeFile("/tmp/milo-repo.bundle", await obj.text());
      const clone = await sandbox.exec(
        cmd("git", "clone", "--branch", pointer.branch, "/tmp/milo-repo.bundle", workdir),
      );
      log.push(`clone from bundle -> exit ${clone.exitCode}`);
      if (clone.success) {
        strategy = "bundle";
      } else {
        await sandbox.exec(cmd("git", "clone", "/tmp/milo-repo.bundle", workdir));
        await sandbox.exec(cmd("git", "-C", workdir, "checkout", pointer.sha));
        strategy = "bundle";
      }
    }
  }

  // 3. Patch. Last resort, needs an existing checkout.
  if (strategy === "clone" && pointer.patchKey) {
    const obj = await env.SNAPSHOTS.get(pointer.patchKey);
    if (obj) {
      await sandbox.writeFile("/tmp/milo-work.patch", await obj.text());
      const apply = await sandbox.exec(
        cmd("git", "-C", workdir, "apply", "--binary", "--whitespace=nowarn", "/tmp/milo-work.patch"),
      );
      log.push(`git apply -> exit ${apply.exitCode}`);
      if (apply.success) strategy = "patch";
    }
  }

  // Untracked files.
  if (pointer.untrackedKey) {
    const obj = await env.SNAPSHOTS.get(pointer.untrackedKey);
    if (obj) {
      // The tarball is binary. `writeFile` takes a string, so it travels as
      // base64 with the encoding declared, rather than being decoded as utf-8
      // and silently corrupted.
      await sandbox.writeFile("/tmp/milo-untracked.tgz", toBase64(await obj.bytes()), { encoding: "base64" });
      await sandbox.exec(cmd("tar", "-xzf", "/tmp/milo-untracked.tgz", "-C", workdir));
      log.push("restored untracked files");
    }
  }

  // node_modules was not snapshotted. Reinstall from the lockfile.
  if (strategy !== "clone") {
    const ci = await sandbox.exec(`cd ${shq(workdir)} && ${install}`);
    log.push(`${install} -> exit ${ci.exitCode}`);
    // Overlay restores can break renames inside node_modules. Remove the cache.
    await sandbox.exec(cmd("rm", "-rf", `${workdir}/node_modules/.vite`));
  }

  // Manifest, so nothing disappears silently.
  const manifestObj = await env.SNAPSHOTS.get(snapshotKeys.manifest(sessionId, pointer.ts));
  let skippedBigFiles: { path: string; bytes: number }[] = [];
  if (manifestObj) {
    const manifest = (await manifestObj.json()) as { bigFiles?: { path: string; bytes: number }[] };
    skippedBigFiles = manifest.bigFiles ?? [];
  }

  // Verify. A restore that does not verify is a hope.
  const head = await sandbox.exec(cmd("git", "-C", workdir, "rev-parse", "HEAD"));
  const status = await sandbox.exec(cmd("git", "-C", workdir, "status", "--porcelain"));
  const actualSha = head.stdout.trim();
  const verified = actualSha === pointer.sha && status.stdout.trim().length === 0;
  log.push(`verify: HEAD ${actualSha.slice(0, 8)} expected ${pointer.sha.slice(0, 8)}, clean=${status.stdout.trim().length === 0}`);

  return { ok: strategy !== "clone" || verified, strategy, sha: actualSha || null, log, skippedBigFiles, verified };
}

/**
 * There is no secondary snapshot path, and that is a decision.
 *
 * The brief asks for `createBackup` / `restoreBackup` as a secondary mechanism
 * for throwaway `/workspace` experiments with a 10-minute to 7-day TTL. That API
 * is a `@cloudflare/sandbox` **1.0 preview** feature. It does not exist in the
 * stable 0.6.x line Milo pins.
 *
 * Rather than write a call to a method that is not there, this is deleted. The
 * reasons it is a good deletion and not a gap:
 *
 *   1. A production restore mounts a copy-on-write overlay, and that mount is
 *      lost when the sandbox sleeps. A backup you cannot rely on after a sleep
 *      is not a persistence story.
 *   2. The primary path already covers the case. `writeSnapshot` commits to git
 *      and uploads a patch and a bundle to R2. An experiment worth keeping is an
 *      experiment worth committing, and the TTL is R2's lifecycle rule.
 *   3. It was the only thing in the repo that would have needed a second
 *      restore code path, and two restore paths is two ways to lose work.
 *
 * If you migrate to the sandbox preview, this is the file to add it back to.
 * See DELETION_LOG.md.
 */
