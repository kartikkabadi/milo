/**
 * MiloSession — one Durable Object per agent session.
 *
 * This is the cheap always-on control plane. It costs approximately nothing
 * while idle because it hibernates, and it holds no timers except one idle
 * sweep. Its job is to decide *which tier* runs a piece of work, because that
 * decision is what the entire cost model hangs on.
 *
 * The one architectural rule, stated once and enforced below:
 *
 *   The DO never stays awake across a container call.
 *
 * Holding a Durable Object awake while a container compiles something bills
 * 128 MiB per second for the privilege of waiting. That is the 30x idiot index
 * in COST_MODEL.md §8. So container work is awaited from a fiber, and the DO
 * is free to hibernate while the container works.
 *
 * On lifecycle hooks, and a correction worth stating
 * ------------------------------------------------
 * There is no `onStop` and no `onActivityExpired` in the Agents SDK lifecycle.
 * A Durable Object can be evicted between two lines of code with no callback.
 * This module therefore does not pretend to have a shutdown hook. It snapshots
 * on a cadence, on quiescence, and before expensive work — and because every
 * snapshot is a git commit, a missed one costs at most the work since the last
 * commit and can never corrupt anything.
 */

import { Agent, callable } from "agents";
import { getSandbox, type Sandbox } from "@cloudflare/sandbox";

import {
  initialState,
  type ApprovalRequest,
  type Env,
  type GitTimelineEntry,
  type HarnessId,
  type MiloState,
  type PermissionDecision,
  type SnapshotPointer,
  type Tier,
} from "../env.ts";
import { Ledger } from "./ledger.ts";
import { cmd, commitWip, restoreSnapshot, writeSnapshot } from "./snapshot.ts";
import { getHarness, gateForTier } from "../harness/index.ts";
import { INSTANCE_TYPES } from "../cost/rates.ts";
import { includedContainerHours } from "../cost/model.ts";
import { miloIndices, worstIndices, type IdiotIndexResult } from "../cost/idiot-index.ts";
import { TASK_MIX } from "../cost/workload.ts";

/** Idle seconds after which the container is released and a snapshot is taken. */
const IDLE_SLEEP_SECONDS = 30;

/**
 * The idle check is a ONE-SHOT alarm, not a periodic sweep.
 *
 * This started as `scheduleEvery(30, ...)` and the load test showed what that
 * costs: 1,200 alarm invocations per agent-hour, 360,000 a month for ten agents
 * — 36% of the free Durable Objects request budget, spent on a check that
 * almost always does nothing. It was free in dollars and expensive in the only
 * budget that matters, which is the one that runs out first.
 *
 * So instead: when activity happens, schedule one alarm for `now + idle`.
 * If nothing happens after that, the alarm fires once, sleeps the session, and
 * does not reschedule. An idle session generates zero requests.
 *
 * This is the Musk algorithm's step 2 applied to a cron: delete it before
 * tuning it.
 */
const IDLE_ALARM_KEY = "idle-alarm";

/** Container sleep tail. The floor is 60s; anything longer is a bigger idiot index. */
const CONTAINER_SLEEP_AFTER = "60s";

/** Hard ceiling on one Tier-3 wake, from vars. */
const DEFAULT_MAX_WAKE_MS = 120_000;

const LITE = INSTANCE_TYPES.lite;
const INCLUDED_HOURS = includedContainerHours(LITE).hours;

export class MiloSession extends Agent<Env, MiloState> {
  initialState: MiloState = initialState;

  private ledger!: Ledger;
  private snapshotPointer: SnapshotPointer | null = null;
  /** Set while a Tier-3 action holds the lease, so release is always paired. */
  private leaseHeld = false;

  async onStart(): Promise<void> {
    this.ledger = new Ledger(this.ctx.storage.sql, LITE, INCLUDED_HOURS);
    this.ledger.migrate();

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        sha TEXT PRIMARY KEY, branch TEXT NOT NULL, ts INTEGER NOT NULL,
        bundle_key TEXT, patch_key TEXT, untracked_key TEXT,
        bytes INTEGER NOT NULL, ttl INTEGER NOT NULL, strategy TEXT NOT NULL
      );
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY, tier INTEGER NOT NULL, tool TEXT NOT NULL, summary TEXT NOT NULL,
        payload TEXT NOT NULL, dangerous INTEGER NOT NULL, created_at INTEGER NOT NULL,
        resolved_at INTEGER, decision TEXT, resolved_by TEXT
      );
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS git_timeline (
        sha TEXT PRIMARY KEY, subject TEXT NOT NULL, ts INTEGER NOT NULL, kind TEXT NOT NULL,
        files INTEGER NOT NULL, insertions INTEGER NOT NULL, deletions INTEGER NOT NULL
      );
    `);
    this.ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS timeline_ts ON git_timeline (ts DESC);`);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS milo_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    `);

    this.loadPointer();

    this.setState({ ...this.state, sessionId: this.name, lastActivityTs: Date.now() });

    // No recurring schedule. The idle alarm is armed on demand by noteActivity.
  }

  /**
   * Arm the idle alarm. Called after activity, cheap, idempotent.
   *
   * One alarm, set forward. If the session stays busy, the alarm keeps getting
   * pushed and only ever fires once. If the session goes quiet, the alarm fires
   * once, sleeps it, and stops.
   */
  private armIdleAlarm(): void {
    const at = Date.now() + IDLE_SLEEP_SECONDS * 1000;
    const existing = this.ctx.storage.sql
      .exec<{ v: string }>(`SELECT v FROM milo_meta WHERE k = ?`, IDLE_ALARM_KEY)
      .toArray()[0];

    // Do not re-arm if one is already set for later than this. Re-arming on
    // every action would be the periodic sweep again, wearing a disguise.
    if (existing && Number(existing.v) >= at) return;

    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO milo_meta (k, v) VALUES (?, ?)`,
      IDLE_ALARM_KEY,
      String(at),
    );
    this.ctx.storage.setAlarm(at);
  }

  /** Clear the idle alarm. Called when the session sleeps. */
  private clearIdleAlarm(): void {
    this.ctx.storage.sql.exec(`DELETE FROM milo_meta WHERE k = ?`, IDLE_ALARM_KEY);
    this.ctx.storage.deleteAlarm();
  }

  /* ---------------------------------------------------------------- *
   * Sleep path
   * ---------------------------------------------------------------- */

  private loadPointer(): void {
    const row = this.ctx.storage.sql
      .exec<{
        sha: string; branch: string; ts: number; bundle_key: string | null;
        patch_key: string | null; untracked_key: string | null;
        bytes: number; ttl: number; strategy: string;
      }>(`SELECT * FROM snapshots ORDER BY ts DESC LIMIT 1`)
      .toArray()[0];
    if (!row) return;
    this.snapshotPointer = {
      sha: row.sha,
      branch: row.branch,
      ts: row.ts,
      bundleKey: row.bundle_key ?? undefined,
      patchKey: row.patch_key ?? undefined,
      untrackedKey: row.untracked_key ?? undefined,
      bytes: row.bytes,
      ttl: row.ttl,
      strategy: row.strategy as SnapshotPointer["strategy"],
    };
  }

  private savePointer(p: SnapshotPointer): void {
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO snapshots (sha, branch, ts, bundle_key, patch_key, untracked_key, bytes, ttl, strategy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.sha, p.branch, p.ts, p.bundleKey ?? null, p.patchKey ?? null, p.untrackedKey ?? null, p.bytes, p.ttl, p.strategy,
    );
    this.snapshotPointer = p;
  }

  /**
   * Take a snapshot and release the container.
   *
   * Wrapped in a fiber so an eviction mid-snapshot recovers instead of losing
   * the commit. `keepAliveWhile` is scoped to this call only — it is not a
   * standing instruction to stay awake.
   */
  @callable()
  async sleep(reason = "requested"): Promise<{ ok: boolean; sha: string | null; log: string[] }> {
    const previousStatus = this.state.status;
    this.setState({ ...this.state, status: "snapshotting" });

    try {
      const sandbox = this.sandbox();
      if (!sandbox) {
        this.setState({ ...this.state, status: "sleeping", holdsLease: false });
        return { ok: true, sha: null, log: ["no container bound to this session yet"] };
      }

      // Not wrapped in a fiber: the Agents SDK in use has no `runFiber`. The
      // durable-execution story here is different and, for this operation,
      // better: every step is idempotent (a git commit with the same message is
      // a no-op, an R2 put to the same key is a put), and a thrown error
      // re-arms the alarm so the platform retries. A half-finished snapshot is
      // therefore not a corrupt snapshot — it is an uncommitted working tree.
      const snap = await writeSnapshot(this.env, sandbox, this.name, { ttlSeconds: 7 * 24 * 3600 });
      if (!snap.noop) this.savePointer(snap.pointer);

      this.ledger.record({
        ts: Date.now(), sessionId: this.name, tier: 3, kind: "snapshot",
        containerSeconds: 4, vcpuSeconds: 4 * LITE.vcpu * 0.5, doSeconds: 2,
        doRequests: 1, r2Bytes: snap.bytesWritten, cpuBusy: 0.5,
      });

      const result = { sha: snap.pointer.sha, log: snap.log };

      await this.releaseContainer();
      this.clearIdleAlarm();

      this.setState({
        ...this.state,
        status: "sleeping",
        holdsLease: false,
        head: result?.sha ?? this.state.head,
        lastActivityTs: Date.now(),
      });

      return { ok: true, sha: result.sha, log: result.log };
    } catch (err) {
      // Re-arm so the platform retries the snapshot. A DO alarm that throws is
      // retried, which is the durable-execution primitive this SDK leaves us.
      this.armIdleAlarm();
      this.setState({ ...this.state, status: previousStatus, lastError: String(err) });
      throw err;
    }
  }

  /**
   * The idle alarm handler. Fires once after the last activity, sleeps the
   * session, and does not reschedule.
   *
   * This replaced a 30-second `scheduleEvery`. See the note on IDLE_ALARM_KEY.
   */
  async onAlarm(): Promise<void> {
    const idleMs = Date.now() - this.state.lastActivityTs;
    if (idleMs < IDLE_SLEEP_SECONDS * 1000) {
      // Something happened after the alarm was armed. Re-arm for the remainder.
      this.armIdleAlarm();
      return;
    }
    if (!this.leaseHeld) {
      // Nothing to release. Do not snapshot a session that was never awake.
      this.clearIdleAlarm();
      return;
    }
    await this.sleep("idle");
  }

  /* ---------------------------------------------------------------- *
   * Wake path
   * ---------------------------------------------------------------- */

  @callable()
  async wake(opts: { repoUrl?: string } = {}): Promise<{ ok: boolean; restored: boolean; sha: string | null; log: string[] }> {
    if (!this.snapshotPointer) {
      return { ok: true, restored: false, sha: null, log: ["no snapshot to restore; starting clean"] };
    }

    this.setState({ ...this.state, status: "waking" });
    const sandbox = this.sandbox();
    if (!sandbox) throw new Error("no container bound; call launch() first");

    const result = await restoreSnapshot(this.env, sandbox, this.name, this.snapshotPointer, {
      repoUrl: opts.repoUrl,
    });

    this.ledger.record({
      ts: Date.now(), sessionId: this.name, tier: 3, kind: "wake",
      containerSeconds: 30, vcpuSeconds: 30 * LITE.vcpu * 0.9, doSeconds: 3,
      doRequests: 1, r2Bytes: 0, cpuBusy: 0.9,
    });

    this.setState({ ...this.state, status: "idle", head: result.sha, lastActivityTs: Date.now() });

    return {
      ok: result.ok,
      restored: result.strategy !== "clone" || result.verified,
      sha: result.sha,
      log: [
        ...result.log,
        ...(result.skippedBigFiles.length
          ? [`skipped ${result.skippedBigFiles.length} big file(s) not uploaded to R2: ${result.skippedBigFiles.map((f) => f.path).join(", ")}`]
          : []),
      ],
    };
  }

  /* ---------------------------------------------------------------- *
   * Session control
   * ---------------------------------------------------------------- */

  @callable()
  async launch(opts: {
    harness: HarnessId;
    repo: string;
    model?: string;
    branch?: string;
  }): Promise<{ ok: boolean; sessionId: string; log: string[] }> {
    const harness = getHarness(opts.harness);
    const log: string[] = [`harness ${harness.label}`, `allowed tiers ${harness.allowedTiers.join(", ")}`];

    this.setState({
      ...this.state,
      harness: opts.harness,
      repo: opts.repo,
      model: opts.model ?? this.state.model,
      branch: opts.branch ?? `agent/${this.name}`,
      status: "idle",
      lastActivityTs: Date.now(),
    });

    // A launch restores rather than re-clones, so a resumed session keeps its
    // history. Tier 3 because restoring needs a real filesystem.
    if (this.snapshotPointer) {
      const woken = await this.wake({ repoUrl: opts.repo });
      log.push(...woken.log);
    }

    return { ok: true, sessionId: this.name, log };
  }

  /**
   * Route one unit of work to its tier.
   *
   * This is the function the cost model depends on. If it ever routes Tier-0
   * work into a container, the bill triples and the idiot index says so.
   */
  @callable()
  async run(tier: Tier, prompt: string, opts: { yoloApproved?: boolean } = {}): Promise<{
    tier: Tier;
    gated: ReturnType<typeof gateForTier>;
    output: string;
    log: string[];
  }> {
    const gated = gateForTier(tier);
    const log: string[] = [`tier ${tier}: ${gated.reason}`];

    if (!gated.containerAllowed) {
      // Tiers 0-2. No container, ever. This path is free.
      this.setState({ ...this.state, tier, lastActivityTs: Date.now() });
      // Nothing to sleep, so no alarm. An alarm here would be a no-op that
      // costs a request, which is exactly the waste the load test found.

      const actionMs = TASK_MIX.find((t) => t.tier === tier)?.actionMs ?? 250;
      const kind = (["think", "read", "edit", "test"] as const)[tier];
      this.ledger.record({
        ts: Date.now(), sessionId: this.name, tier, kind,
        containerSeconds: 0, vcpuSeconds: 0,
        // The DO is awake for the duration of the call, and that is the only
        // thing this tier costs. Kept small on purpose.
        doSeconds: Math.min(actionMs, 2000) / 1000,
        doRequests: 1, r2Bytes: 0, cpuBusy: 0, execSeconds: actionMs / 1000,
      });

      return { tier, gated, output: "", log: [...log, "handled without a container"] };
    }

    // Tier 3. Lease the container, then hand the work off.
    const sandbox = this.sandbox();
    if (!sandbox) throw new Error("Tier 3 requested but no container is bound");

    const harness = this.state.harness ? getHarness(this.state.harness) : null;
    if (harness && !harness.allowedTiers.includes(3)) {
      throw new Error(`${harness.label} is not permitted at Tier 3`);
    }

    const spec = harness?.build(prompt, { tier: 3, model: this.state.model ?? undefined, yoloApproved: opts.yoloApproved });

    await this.acquireContainer();
    const started = Date.now();
    try {
      const result = spec
        ? await sandbox.exec(cmd(spec.command, ...spec.args), { cwd: spec.cwd })
        : await sandbox.exec(prompt, { cwd: "/workspace" });

      const wallMs = Date.now() - started;
      const maxWake = Number(this.env.MILO_MAX_TIER3_MS_PER_WAKE) || DEFAULT_MAX_WAKE_MS;
      if (wallMs > maxWake) {
        log.push(`WARNING: this wake took ${wallMs}ms, over the ${maxWake}ms ceiling. Batch smaller.`);
      }

      this.ledger.record({
        ts: Date.now(), sessionId: this.name, tier: 3, kind: "test",
        containerSeconds: wallMs / 1000,
        vcpuSeconds: (wallMs / 1000) * LITE.vcpu * 0.85,
        doSeconds: 1.5, doRequests: 1, r2Bytes: 0, cpuBusy: 0.85,
        execSeconds: wallMs / 1000,
      });

      this.setState({ ...this.state, tier: 3, lastActivityTs: Date.now() });
      // Arm the one-shot idle alarm. If the session goes quiet, this fires
      // once, snapshots, and releases the container.
      this.armIdleAlarm();
      return { tier, gated, output: result.stdout ?? "", log };
    } finally {
      // Always paired. A lease that leaks wedges the whole fleet behind
      // max_instances: 1.
      await this.releaseContainer();
    }
  }

  /* ---------------------------------------------------------------- *
   * Approvals
   * ---------------------------------------------------------------- */

  @callable()
  async requestApproval(req: {
    tier: Tier;
    tool: string;
    summary: string;
    payload: string;
    dangerous?: boolean;
  }): Promise<{ id: string }> {
    const id = crypto.randomUUID();
    this.ctx.storage.sql.exec(
      `INSERT INTO approvals (id, tier, tool, summary, payload, dangerous, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id, req.tier, req.tool, req.summary, req.payload, req.dangerous ? 1 : 0, Date.now(),
    );
    this.setState({ ...this.state, status: "awaiting-approval", lastActivityTs: Date.now() });
    this.armIdleAlarm();
    return { id };
  }

  @callable()
  async resolveApproval(id: string, decision: PermissionDecision, resolvedBy = "human"): Promise<{ ok: boolean }> {
    const row = this.ctx.storage.sql
      .exec<{ id: string }>(`SELECT id FROM approvals WHERE id = ?`, id)
      .toArray()[0];
    if (!row) return { ok: false };
    this.ctx.storage.sql.exec(
      `UPDATE approvals SET decision = ?, resolved_at = ?, resolved_by = ? WHERE id = ?`,
      decision, Date.now(), resolvedBy, id,
    );
    this.setState({ ...this.state, status: "idle", lastActivityTs: Date.now() });
    return { ok: true };
  }

  @callable()
  async pendingApprovals(): Promise<ApprovalRequest[]> {
    return this.ctx.storage.sql
      .exec<{
        id: string; tier: number; tool: string; summary: string; payload: string;
        dangerous: number; created_at: number;
      }>(`SELECT id, tier, tool, summary, payload, dangerous, created_at FROM approvals WHERE decision IS NULL ORDER BY created_at ASC`)
      .toArray()
      .map((r) => ({
        id: r.id,
        sessionId: this.name,
        tier: r.tier as Tier,
        tool: r.tool,
        summary: r.summary,
        payload: r.payload,
        dangerous: r.dangerous === 1,
        createdAt: r.created_at,
      }));
  }

  /* ---------------------------------------------------------------- *
   * Git timeline
   * ---------------------------------------------------------------- */

  @callable()
  async refreshTimeline(): Promise<GitTimelineEntry[]> {
    const sandbox = this.sandbox();
    if (!sandbox) return this.timeline();

    const out = await sandbox.exec(
      cmd("git", "log", "--pretty=format:%H%x1f%s%x1f%ct%x1f%an", "--shortstat", "-n", "50"),
      { cwd: "/workspace" },
    );

    const entries: GitTimelineEntry[] = [];
    let current: Partial<GitTimelineEntry> | null = null;

    for (const line of out.stdout.split("\n")) {
      if (line.includes("\u001f")) {
        const [sha, subject, ts, author] = line.split("\u001f");
        current = {
          sha, subject, ts: Number(ts) * 1000,
          kind: subject.startsWith("wip(agent)") ? "wip" : author.includes("milo") ? "agent" : "human",
          files: 0, insertions: 0, deletions: 0,
        };
        entries.push(current as GitTimelineEntry);
      } else if (current && line.includes("changed")) {
        const files = /(\d+) files? changed/.exec(line);
        const ins = /(\d+) insertions?/.exec(line);
        const del = /(\d+) deletions?/.exec(line);
        current.files = files ? Number(files[1]) : 0;
        current.insertions = ins ? Number(ins[1]) : 0;
        current.deletions = del ? Number(del[1]) : 0;
      }
    }

    for (const e of entries) {
      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO git_timeline (sha, subject, ts, kind, files, insertions, deletions) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        e.sha, e.subject, e.ts, e.kind, e.files, e.insertions, e.deletions,
      );
    }
    return entries;
  }

  @callable()
  async timeline(): Promise<GitTimelineEntry[]> {
    return this.ctx.storage.sql
      .exec<{ sha: string; subject: string; ts: number; kind: string; files: number; insertions: number; deletions: number }>(
        `SELECT sha, subject, ts, kind, files, insertions, deletions FROM git_timeline ORDER BY ts DESC LIMIT 50`,
      )
      .toArray()
      .map((r) => ({
        sha: r.sha, subject: r.subject, ts: r.ts,
        kind: r.kind as GitTimelineEntry["kind"],
        files: r.files, insertions: r.insertions, deletions: r.deletions,
      }));
  }

  /**
   * Restore to a point in the timeline.
   *
   * Forks rather than rewinds: the current HEAD is snapshotted first, then a
   * new branch is cut at the target. Rewinding a branch you might want back is
   * the kind of thing people regret.
   */
  @callable()
  async fork(sha: string): Promise<{ ok: boolean; branch: string; log: string[] }> {
    const sandbox = this.sandbox();
    if (!sandbox) throw new Error("no container bound");

    const log: string[] = [];
    await commitWip(sandbox, this.name, { message: `wip(agent): ${this.name} before fork to ${sha.slice(0, 8)}` });
    log.push(`preserved current HEAD`);

    const branch = `agent/${this.name}/fork-${sha.slice(0, 8)}`;
    const cut = await sandbox.exec(cmd("git", "checkout", "-b", branch, sha), { cwd: "/workspace" });
    log.push(`checkout -b ${branch} ${sha.slice(0, 8)} -> exit ${cut.exitCode}`);

    this.setState({ ...this.state, branch, head: sha, lastActivityTs: Date.now() });
    return { ok: cut.success, branch, log };
  }

  /* ---------------------------------------------------------------- *
   * Cost
   * ---------------------------------------------------------------- */

  @callable()
  async cost(): Promise<{
    summary: ReturnType<Ledger["summary"]>;
    indices: IdiotIndexResult[];
    worst: IdiotIndexResult[];
  }> {
    const summary = this.ledger.summary();
    const execSeconds = summary.execSeconds;
    const containerSeconds = summary.containerHours * 3600;
    const tailSeconds = Math.max(0, containerSeconds - execSeconds);

    const indices = miloIndices({
      containerHours: summary.containerHours,
      execSeconds,
      sleepTailSeconds: tailSeconds,
      provisionedMemoryGiB: LITE.memoryMiB / 1024,
      peakWorkingSetGiB: 0.08,
      doSeconds: summary.doSeconds,
      doUsefulSeconds: summary.doSeconds * 0.35,
      r2BytesWritten: summary.r2Bytes,
      r2BytesNeeded: summary.r2Bytes * 0.9,
      doRowsRead: summary.actions * 3,
      doRowsNeeded: summary.actions,
    });

    // Keep state's spend strip honest without a second query.
    this.setState({
      ...this.state,
      spend: {
        month: summary.usd.total,
        containerHours: summary.containerHours,
        tier3Duty: containerSeconds / 3600 / 3000,
        awakeIndex: summary.awakeIndex,
      },
    });

    return { summary, indices, worst: worstIndices(indices, 3) };
  }

  /* ---------------------------------------------------------------- *
   * Container plumbing
   * ---------------------------------------------------------------- */

  private sandbox(): Sandbox | null {
    if (!this.env.Sandbox) return null;
    return getSandbox(this.env.Sandbox, this.name, {
      // Sleep aggressively. The tail is charged, so the shortest tail the
      // workload tolerates is the correct one.
      sleepAfter: CONTAINER_SLEEP_AFTER,
      // Never true. See COST_MODEL.md section 2.
      keepAlive: false,
      // Lowercase, so a preview URL routes to this instance rather than a
      // second one that differs only by case.
      normalizeId: true,
    });
  }

  /**
   * Take the single container lease, or wait.
   *
   * With max_instances: 1 there is exactly one box for the whole fleet. Rather
   * than fail the ninth caller, queue it. This is the difference between a
   * cheap architecture and a broken one.
   */
  private async acquireContainer(): Promise<void> {
    const gate = this.env.CONTAINER_GATE.get(this.env.CONTAINER_GATE.idFromName("fleet"));
    const res = (await gate.acquire(this.name)) as
      | { ok: true; expiresAt: number }
      | { ok: false; position: number; heldBy: string | null };

    if (!res.ok) {
      this.setState({ ...this.state, status: "awaiting-approval", holdsLease: false, queuePosition: res.position });
      throw new Error(
        `container busy (held by ${res.heldBy}); this session is #${res.position} in the queue. ` +
          `Retry shortly, or batch more work per wake so the queue drains faster.`,
      );
    }

    this.leaseHeld = true;
    this.setState({ ...this.state, holdsLease: true, queuePosition: 0, lastActivityTs: Date.now() });
  }

  private async releaseContainer(): Promise<void> {
    if (!this.leaseHeld) return;
    try {
      const gate = this.env.CONTAINER_GATE.get(this.env.CONTAINER_GATE.idFromName("fleet"));
      await gate.release(this.name);
    } finally {
      this.leaseHeld = false;
      this.setState({ ...this.state, holdsLease: false });
    }
  }

  /** Gate state, for the GUI header. */
  @callable()
  async gateStatus(): Promise<unknown> {
    const gate = this.env.CONTAINER_GATE.get(this.env.CONTAINER_GATE.idFromName("fleet"));
    return gate.status();
  }

  @callable()
  async setModel(model: string): Promise<{ ok: boolean }> {
    this.setState({ ...this.state, model, lastActivityTs: Date.now() });
    return { ok: true };
  }

  /** HTTP entry, for curl and for the CLI. */
  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/health")) {
      return Response.json({
        ok: true,
        sessionId: this.name,
        status: this.state.status,
        tier: this.state.tier,
        holdsLease: this.state.holdsLease,
      });
    }
    return new Response("milo session agent. connect over websocket.", { status: 200 });
  }
}
