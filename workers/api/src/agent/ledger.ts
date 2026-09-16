/**
 * The cost ledger, backed by DO SQLite.
 *
 * Design constraint that shapes everything here: DO rows written are billed
 * (50M/month included, then $1.00/million). A ledger that writes a row per
 * WebSocket message would blow that budget on its own. So:
 *
 *   - One row per *billed action*, not per event.
 *   - Aggregates are maintained incrementally, so the GUI never triggers a scan.
 *   - The month rollup is a single row, updated in place.
 *
 * Rows read are also billed (25B/month included). The GUI's cost panel is the
 * hot path, so it reads one precomputed row. An unindexed `SELECT *` per
 * keystroke would be a 50x idiot index, which is the exact failure the model
 * warns about in COST_MODEL.md §8.
 */

import { CONTAINERS, DURABLE_OBJECTS, PLAN_BASE_USD, SECONDS_PER_HOUR } from "../cost/rates.ts";
import type { LedgerEntry, Tier } from "../env.ts";

export interface LedgerSummary {
  month: string;
  containerHours: number;
  containerVcpuSeconds: number;
  doSeconds: number;
  doRequests: number;
  r2Bytes: number;
  actions: number;
  byTier: Record<string, { actions: number; containerHours: number }>;
  /** Derived. */
  usd: {
    containerMemory: number;
    containerDisk: number;
    containerCpu: number;
    containers: number;
    base: number;
    total: number;
  };
  /** Container awake vs useful exec. Above 10 is flagged. */
  awakeIndex: number;
  /** Seconds of container exec, summed from actions that actually did work. */
  execSeconds: number;
}

/**
 * DO SQLite, as the runtime actually types it.
 *
 * Used rather than a hand-written structural type because the two disagreed:
 * a hand-written `{ exec<T>(...): { toArray(): T[] } }` is not assignable to
 * the real `SqlStorage`, and narrowing the real type to match a guess is how
 * you end up with a ledger that compiles and throws.
 */
export type SqlLike = DurableObjectState["storage"]["sql"];

const monthKey = (ts = Date.now()): string => new Date(ts).toISOString().slice(0, 7);

export class Ledger {
  constructor(
    private readonly sql: SqlLike,
    private readonly instance: { vcpu: number; memoryMiB: number; diskGb: number },
    private readonly includedHours: number,
  ) {}

  migrate(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS ledger (
        ts INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        tier INTEGER NOT NULL,
        kind TEXT NOT NULL,
        container_seconds REAL NOT NULL,
        vcpu_seconds REAL NOT NULL,
        do_seconds REAL NOT NULL,
        do_requests REAL NOT NULL,
        r2_bytes INTEGER NOT NULL,
        cpu_busy REAL NOT NULL,
        exec_seconds REAL NOT NULL
      );
    `);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS ledger_ts ON ledger (ts);`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS ledger_month ON ledger (session_id, ts);`);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS rollup (
        month TEXT PRIMARY KEY,
        container_hours REAL NOT NULL,
        container_vcpu_seconds REAL NOT NULL,
        do_seconds REAL NOT NULL,
        do_requests REAL NOT NULL,
        r2_bytes INTEGER NOT NULL,
        actions INTEGER NOT NULL,
        exec_seconds REAL NOT NULL
      );
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS rollup_tier (
        month TEXT NOT NULL,
        tier INTEGER NOT NULL,
        actions INTEGER NOT NULL,
        container_hours REAL NOT NULL,
        PRIMARY KEY (month, tier)
      );
    `);
  }

  /**
   * Record one billed action.
   *
   * `execSeconds` is the time that produced a useful result. The difference
   * between it and `containerSeconds` is the sleep tail plus container
   * overhead, which is exactly what the idiot index measures.
   */
  record(entry: LedgerEntry & { execSeconds?: number }): void {
    const month = monthKey(entry.ts);
    const exec = entry.execSeconds ?? entry.containerSeconds;

    this.sql.exec(
      `INSERT INTO ledger (ts, session_id, tier, kind, container_seconds, vcpu_seconds, do_seconds, do_requests, r2_bytes, cpu_busy, exec_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      entry.ts,
      entry.sessionId,
      entry.tier,
      entry.kind,
      entry.containerSeconds,
      entry.vcpuSeconds,
      entry.doSeconds,
      entry.doRequests,
      entry.r2Bytes,
      entry.cpuBusy,
      exec,
    );

    this.sql.exec(
      `INSERT INTO rollup (month, container_hours, container_vcpu_seconds, do_seconds, do_requests, r2_bytes, actions, exec_seconds)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(month) DO UPDATE SET
         container_hours = container_hours + excluded.container_hours,
         container_vcpu_seconds = container_vcpu_seconds + excluded.container_vcpu_seconds,
         do_seconds = do_seconds + excluded.do_seconds,
         do_requests = do_requests + excluded.do_requests,
         r2_bytes = r2_bytes + excluded.r2_bytes,
         actions = actions + 1,
         exec_seconds = exec_seconds + excluded.exec_seconds`,
      month,
      entry.containerSeconds / SECONDS_PER_HOUR,
      entry.vcpuSeconds,
      entry.doSeconds,
      entry.doRequests,
      entry.r2Bytes,
      exec,
    );

    this.sql.exec(
      `INSERT INTO rollup_tier (month, tier, actions, container_hours)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(month, tier) DO UPDATE SET
         actions = actions + 1,
         container_hours = container_hours + excluded.container_hours`,
      month,
      entry.tier,
      entry.containerSeconds / SECONDS_PER_HOUR,
    );
  }

  /** One row read. This is the path the GUI hits on every render. */
  summary(month = monthKey()): LedgerSummary {
    const rollup = this.sql
      .exec<{
        container_hours: number;
        container_vcpu_seconds: number;
        do_seconds: number;
        do_requests: number;
        r2_bytes: number;
        actions: number;
        exec_seconds: number;
      }>(
        `SELECT container_hours, container_vcpu_seconds, do_seconds, do_requests, r2_bytes, actions, exec_seconds
         FROM rollup WHERE month = ?`,
        month,
      )
      .toArray()[0];

    const tiers = this.sql
      .exec<{ tier: number; actions: number; container_hours: number }>(
        `SELECT tier, actions, container_hours FROM rollup_tier WHERE month = ? ORDER BY tier ASC`,
        month,
      )
      .toArray();

    const containerHours = rollup?.container_hours ?? 0;
    const vcpuSeconds = rollup?.container_vcpu_seconds ?? 0;
    const doSeconds = rollup?.do_seconds ?? 0;
    const doRequests = rollup?.do_requests ?? 0;
    const r2Bytes = rollup?.r2_bytes ?? 0;
    const execSeconds = rollup?.exec_seconds ?? 0;

    const billableHours = Math.max(0, containerHours - this.includedHours);
    const memoryUsd = billableHours * (this.instance.memoryMiB / 1024) * SECONDS_PER_HOUR * CONTAINERS.memoryPerGiBS;
    const diskUsd = billableHours * this.instance.diskGb * SECONDS_PER_HOUR * CONTAINERS.diskPerGbS;
    const cpuUsd = Math.max(0, vcpuSeconds - CONTAINERS.cpuIncludedVcpuMin * 60) * CONTAINERS.cpuPerVcpuS;

    const doGiBS = doSeconds * DURABLE_OBJECTS.billedMemoryGiB;
    const doBillable = Math.max(0, doGiBS - DURABLE_OBJECTS.durationIncludedGiBS);
    const doDurationUsd = Math.ceil(doBillable / 1_000_000) * DURABLE_OBJECTS.durationPerMillionGiBS;
    const doReqBillable = Math.max(0, doRequests - DURABLE_OBJECTS.requestsIncluded);
    const doReqUsd = Math.ceil(doReqBillable / 1_000_000) * DURABLE_OBJECTS.requestsPerMillion;

    const containers = memoryUsd + diskUsd + cpuUsd;

    const byTier: Record<string, { actions: number; containerHours: number }> = {};
    for (const t of tiers) {
      byTier[String(t.tier)] = { actions: t.actions, containerHours: t.container_hours };
    }

    return {
      month,
      containerHours,
      containerVcpuSeconds: vcpuSeconds,
      doSeconds,
      doRequests,
      r2Bytes,
      actions: rollup?.actions ?? 0,
      byTier,
      usd: {
        containerMemory: memoryUsd,
        containerDisk: diskUsd,
        containerCpu: cpuUsd,
        containers,
        base: PLAN_BASE_USD,
        total: PLAN_BASE_USD + containers + doDurationUsd + doReqUsd,
      },
      awakeIndex: execSeconds > 0 ? containerHours * SECONDS_PER_HOUR / execSeconds : 1,
      execSeconds,
    };
  }

  /** Recent actions for the timeline strip. Bounded, indexed. */
  recent(limit = 50): LedgerEntry[] {
    return this.sql
      .exec<{
        ts: number;
        session_id: string;
        tier: number;
        kind: string;
        container_seconds: number;
        vcpu_seconds: number;
        do_seconds: number;
        do_requests: number;
        r2_bytes: number;
        cpu_busy: number;
      }>(
        `SELECT ts, session_id, tier, kind, container_seconds, vcpu_seconds, do_seconds, do_requests, r2_bytes, cpu_busy
         FROM ledger ORDER BY ts DESC LIMIT ?`,
        limit,
      )
      .toArray()
      .map((r) => ({
        ts: r.ts,
        sessionId: r.session_id,
        tier: r.tier as Tier,
        kind: r.kind as LedgerEntry["kind"],
        containerSeconds: r.container_seconds,
        vcpuSeconds: r.vcpu_seconds,
        doSeconds: r.do_seconds,
        doRequests: r.do_requests,
        r2Bytes: r.r2_bytes,
        cpuBusy: r.cpu_busy,
      }));
  }

  /**
   * Drop ledger rows older than N months. Keeps rows-read bounded forever,
   * which matters because rows read are billed.
   */
  prune(monthsToKeep = 3): number {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - monthsToKeep);
    const before = this.sql
      .exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ledger WHERE ts < ?`, cutoff.getTime())
      .toArray()[0]?.n ?? 0;
    if (before > 0) {
      this.sql.exec(`DELETE FROM ledger WHERE ts < ?`, cutoff.getTime());
    }
    return before;
  }
}
