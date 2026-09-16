/**
 * ContainerGate — the single-lease queue in front of `max_instances: 1`.
 *
 * Why this exists
 * ---------------
 * The wrangler config ships `max_instances: 1`. That is the cheapest possible
 * configuration: one `lite` container, shared by all sessions. The moment you
 * ship that, you need an answer to "ten agents want the container at once,
 * what happens?" The platform's answer is that nine of them fail. That is not
 * an answer a product can ship.
 *
 * So: one lease. A session acquires it, does its Tier-3 work, releases it.
 * Waiting sessions queue. The queue is a DO, it hibernates, and it costs
 * approximately nothing.
 *
 * Why not raise max_instances instead
 * -----------------------------------
 * Because it multiplies the overage linearly. Ten concurrent containers is
 * 10x the memory bill for a workload whose duty cycle is 18%. You would be
 * paying for nine idle boxes so that nine agents can each wait less. That is
 * the definition of an idiot index, and COST_MODEL.md §7 prices it.
 *
 * Cost note
 * ---------
 * This DO holds no timers while idle and no WebSockets. It wakes on acquire,
 * release, and status. Its duty cycle is near zero, which keeps it inside the
 * 400,000 GB-s duration inclusion with room to spare.
 */

import { DurableObject } from "cloudflare:workers";

interface Lease {
  sessionId: string;
  acquiredAt: number;
  /** Hard ceiling. A session that dies without releasing cannot wedge the gate. */
  expiresAt: number;
}

/** A Tier-3 lease is capped at 5 minutes of wall clock by default. */
const DEFAULT_LEASE_MS = 5 * 60 * 1000;

export class ContainerGate extends DurableObject {
  // The gate reads no bindings, so its env is deliberately unknown-shaped.
  // Typing it as an empty object would be a lie that invites someone to add a
  // binding later without noticing it is not plumbed through.
  constructor(ctx: DurableObjectState, env: Record<string, never>) {
    super(ctx, env);
    void this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS queue (
          session_id TEXT PRIMARY KEY,
          enqueued_at INTEGER NOT NULL
        );
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS meta (
          k TEXT PRIMARY KEY,
          v TEXT NOT NULL
        );
      `);
    });
  }

  /** Current lease, if any. Expired leases are reaped on read. */
  private currentLease(): Lease | null {
    const rows = this.ctx.storage.sql
      .exec<{ k: string; v: string }>(`SELECT k, v FROM meta WHERE k = 'lease'`)
      .toArray();
    if (rows.length === 0) return null;
    const lease = JSON.parse(rows[0].v) as Lease;
    if (lease.expiresAt <= Date.now()) {
      this.ctx.storage.sql.exec(`DELETE FROM meta WHERE k = 'lease'`);
      return null;
    }
    return lease;
  }

  private queueRows(): { session_id: string; enqueued_at: number }[] {
    return this.ctx.storage.sql
      .exec<{ session_id: string; enqueued_at: number }>(
        `SELECT session_id, enqueued_at FROM queue ORDER BY enqueued_at ASC`,
      )
      .toArray();
  }

  /**
   * Acquire the lease. Returns immediately if free, otherwise reports the
   * caller's position so the GUI can show an honest "waiting" state instead
   * of a spinner.
   */
  async acquire(sessionId: string, leaseMs = DEFAULT_LEASE_MS): Promise<
    | { ok: true; expiresAt: number }
    | { ok: false; position: number; heldBy: string | null }
  > {
    const lease = this.currentLease();

    if (!lease) {
      const next: Lease = {
        sessionId,
        acquiredAt: Date.now(),
        expiresAt: Date.now() + leaseMs,
      };
      this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO meta (k, v) VALUES ('lease', ?)`, JSON.stringify(next));
      this.ctx.storage.sql.exec(`DELETE FROM queue WHERE session_id = ?`, sessionId);
      return { ok: true, expiresAt: next.expiresAt };
    }

    if (lease.sessionId === sessionId) {
      return { ok: true, expiresAt: lease.expiresAt };
    }

    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO queue (session_id, enqueued_at) VALUES (?, ?)`,
      sessionId,
      Date.now(),
    );
    const queue = this.queueRows();
    const position = queue.findIndex((r) => r.session_id === sessionId) + 1;
    return { ok: false, position: position || queue.length + 1, heldBy: lease.sessionId };
  }

  /**
   * Release and hand the lease to the next waiter, if any. Returns the new
   * holder so the caller can be woken with a real message rather than a poll.
   */
  async release(sessionId: string): Promise<{ handedTo: string | null }> {
    const lease = this.currentLease();
    if (lease && lease.sessionId !== sessionId) {
      // Someone else owns it. Refuse rather than let a buggy caller steal it.
      return { handedTo: null };
    }
    this.ctx.storage.sql.exec(`DELETE FROM meta WHERE k = 'lease'`);
    this.ctx.storage.sql.exec(`DELETE FROM queue WHERE session_id = ?`, sessionId);

    const queue = this.queueRows();
    if (queue.length === 0) return { handedTo: null };

    const next = queue[0].session_id;
    const newLease: Lease = {
      sessionId: next,
      acquiredAt: Date.now(),
      expiresAt: Date.now() + DEFAULT_LEASE_MS,
    };
    this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO meta (k, v) VALUES ('lease', ?)`, JSON.stringify(newLease));
    this.ctx.storage.sql.exec(`DELETE FROM queue WHERE session_id = ?`, next);
    return { handedTo: next };
  }

  /** Extend a lease that is legitimately still working. Bounded, so it cannot leak. */
  async extend(sessionId: string, leaseMs = DEFAULT_LEASE_MS): Promise<{ ok: boolean; expiresAt: number }> {
    const lease = this.currentLease();
    if (!lease || lease.sessionId !== sessionId) {
      return { ok: false, expiresAt: 0 };
    }
    // Cap total hold time so a runaway session cannot starve the queue forever.
    const maxHold = 30 * 60 * 1000;
    const expiresAt = Math.min(lease.acquiredAt + maxHold, Date.now() + leaseMs);
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO meta (k, v) VALUES ('lease', ?)`,
      JSON.stringify({ ...lease, expiresAt }),
    );
    return { ok: true, expiresAt };
  }

  /** Full gate state. Used by the GUI header. */
  async status(): Promise<{
    heldBy: string | null;
    expiresAt: number;
    queue: { sessionId: string; position: number }[];
  }> {
    const lease = this.currentLease();
    const queue = this.queueRows();
    return {
      heldBy: lease?.sessionId ?? null,
      expiresAt: lease?.expiresAt ?? 0,
      queue: queue.map((r, i) => ({ sessionId: r.session_id, position: i + 1 })),
    };
  }
}
