/**
 * Landing page.
 *
 * Section order is the argument, not a preference. See brand/hero-copy.md.
 * Nav / Hero / numbers / Watch-Wake-Prove / live mini-diff / watch rules /
 * Milo vs generic / quotes / pricing / FAQ / footer.
 *
 * Two rules that shape everything here:
 *   - Real product UI over gradient blobs.
 *   - Real numbers only. Every figure on this page is printed by `bun run cost`.
 */

import { useState } from "react";
import { Mark, Meander, SleepWakeRing, Wordmark } from "../components/Brand";
import { MiniDiff } from "../components/DiffViewer";
import { ThemeMenu } from "../components/ThemeMenu";

/* Every number here is reproduced by `bun run cost`. See COST_MODEL.md. */
const NUMBERS = [
  { value: "$5.00", label: "Workers Paid base plan" },
  { value: "100", label: "container-hours included per month, lite" },
  { value: "3,000", label: "agent-hours modelled" },
  { value: "18%", label: "Tier-3 duty at the shipped default" },
  { value: "$7.02", label: "total monthly cost for 3,000 agent-hours" },
  { value: "30×", label: "idiot index on keepAlive: true" },
];

const COMPARE = [
  ["wakes for every step", "wakes for the step that needs a filesystem"],
  ["a container per agent, always on", "one container, leased and queued"],
  ["deletes the branch on failure", "commits a wip(agent) and leaves the diff"],
  ["asks permission for git status", "asks once, for the thing that is destructive"],
  ["reports tokens burned", "reports the idiot index"],
];

const FAQ = [
  {
    q: "Does Milo run my code in my account?",
    a: "Yes. Milo is a Cloudflare Worker, a Durable Object per session, and one container. It deploys to your account with wrangler and never calls a Milo server, because there isn't one.",
  },
  {
    q: "What happens to my files when a session sleeps?",
    a: "Disk is ephemeral and Milo does not pretend otherwise. It commits a wip(agent) snapshot to git, uploads a patch and a bundle to R2, and restores with git reset --hard on wake. node_modules is never snapshotted; the committed lockfile rebuilds it.",
  },
  {
    q: "Do I need my own Cloudflare account?",
    a: "Yes, on the Workers Paid plan, because Containers and the Agents SDK need it. The $5 base is the floor and Milo is built to stay near it.",
  },
  {
    q: "Why is there no license?",
    a: "The brief said no license file, so there isn't one. The code is written to be MIT-able: no copyleft dependencies, no vendored code, no secrets. Add a LICENSE file if you want one.",
  },
  {
    q: "Which harnesses does it support?",
    a: "Pi and OpenCode, as two separate adapters. Pi runs in every tier. OpenCode's Plan, Explore, and Scout stay read-only in Tiers 0-1; Build is Tier 3 only. Provider sign-in — API keys and OAuth — lives in the app's Connect panel, not in a TUI.",
  },
  {
    q: "What does it cost at 10 agents?",
    a: "At 10 agents x 10 hours x 30 days on a 30/30/20/20 mix, $7.02 a month. The arithmetic is in COST_MODEL.md and reproduced by bun run cost. It is not $5, and the page says so above the fold.",
  },
];

const WATCH_RULES_TASTE = `# taste.md

- Never force-push. Commit a wip(agent) and leave the diff.
- Ask before deleting a branch, a migration, or anything in .github/.
- Prefer the smallest diff that makes the test pass.
- Run the fast suite on every save. Run the full suite before you sleep.
- If a test was already failing, say so and stop. Do not fix it.
- Never edit a lockfile by hand.`;

const WATCH_RULES_YAML = `# milo.yaml
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
  ttlSeconds: 604800`;

function Section({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mx-auto w-full max-w-5xl px-6 py-16">
      {children}
    </section>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mono text-xs" style={{ color: "var(--accent)" }}>
      {children}
    </p>
  );
}

export function Landing() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText("git clone https://github.com/kartikkabadi/milo.git");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div style={{ background: "var(--background)" }}>
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b backdrop-blur" style={{ borderColor: "var(--border)", background: "color-mix(in oklab, var(--background) 88%, transparent)" }}>
        <nav className="mx-auto flex w-full max-w-5xl items-center gap-6 px-6 py-3">
          <a href="/" aria-label="milo" style={{ color: "var(--accent)" }}>
            <Mark size={24} />
          </a>
          <div className="hidden gap-5 text-xs sm:flex" style={{ color: "var(--muted)" }}>
            <a href="#how" className="hover:text-[var(--foreground)]">How it works</a>
            <a href="#rules" className="hover:text-[var(--foreground)]">Watch rules</a>
            <a href="#themes" className="hover:text-[var(--foreground)]">Themes</a>
            <a href="#pricing" className="hover:text-[var(--foreground)]">Pricing</a>
            <a href="https://github.com/kartikkabadi/milo" className="hover:text-[var(--foreground)]">GitHub</a>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <ThemeMenu />
            <a
              href="/app"
              className="rounded-md px-3 py-1.5 text-xs font-medium"
              style={{ background: "var(--accent)", color: "var(--background)" }}
            >
              Get started
            </a>
          </div>
        </nav>
        <div className="meander" />
      </header>

      {/* Hero */}
      <Section>
        <Eyebrow>{"// meet Milo"}</Eyebrow>
        <h1 className="display mt-4 text-5xl leading-[1.05] sm:text-6xl">
          The watcher that ships
          <br />
          while you sleep.
        </h1>
        <p className="mt-5 max-w-xl text-base" style={{ color: "var(--muted)" }}>
          Milo keeps your main green. You keep building.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <a
            href="/app"
            className="rounded-md px-4 py-2 text-sm font-medium"
            style={{ background: "var(--accent)", color: "var(--background)" }}
          >
            Get started
          </a>
          <a
            href="https://github.com/kartikkabadi/milo#readme"
            className="rounded-md border px-4 py-2 text-sm"
            style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
          >
            Read docs
          </a>
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <code className="text-sm">git clone https://github.com/kartikkabadi/milo.git</code>
            <button type="button" onClick={() => void copy()} className="rounded px-2 py-1 text-[11px]" style={{ background: "var(--surface-2)", color: copied ? "var(--success)" : "var(--muted)" }}>
              {copied ? "copied" : "copy"}
            </button>
          </div>
          {/* Real product UI, not a mockup. This is the sleep/wake ring doing
              the one piece of motion the brand owns. */}
          <div className="flex items-center gap-4 rounded-lg border px-4 py-2.5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <SleepWakeRing status="sleeping" size={40} />
            <SleepWakeRing status="testing" size={40} />
            <div className="text-[11px]" style={{ color: "var(--muted)" }}>
              <p>Ring closes on sleep, opens on wake.</p>
              <p style={{ color: "var(--dim)" }}>Motion is theme-independent.</p>
            </div>
          </div>
        </div>
      </Section>

      {/* Numbers. Real ones. */}
      <div className="border-y" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="mx-auto grid w-full max-w-5xl grid-cols-2 gap-x-6 gap-y-8 px-6 py-12 sm:grid-cols-3 lg:grid-cols-6">
          {NUMBERS.map((n) => (
            <div key={n.label}>
              <div className="mono text-xl" style={{ color: "var(--foreground)" }}>
                {n.value}
              </div>
              <div className="mt-1 text-[11px] leading-snug" style={{ color: "var(--dim)" }}>
                {n.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Watch / Wake / Prove */}
      <Section id="how">
        <Eyebrow>{"// how it works"}</Eyebrow>
        <h2 className="display mt-3 text-3xl">Watch, wake, prove.</h2>
        <div className="mt-10 grid gap-10 md:grid-cols-3">
          {[
            {
              n: "01",
              t: "Watch",
              b: "milo watch binds a session to a repo. The agent reads, thinks, and edits inside a Durable Object. No container is running, so the meter is not running.",
              ui: (
                <div className="rounded-lg border p-3 text-[11px]" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                  <div className="flex justify-between" style={{ color: "var(--muted)" }}>
                    <span className="mono">tier</span>
                    <span className="mono" style={{ color: "var(--accent-2)" }}>T1 read</span>
                  </div>
                  <div className="mt-2 flex justify-between" style={{ color: "var(--muted)" }}>
                    <span className="mono">container</span>
                    <span className="mono" style={{ color: "var(--dim)" }}>none</span>
                  </div>
                  <div className="mt-2 flex justify-between" style={{ color: "var(--muted)" }}>
                    <span className="mono">cost</span>
                    <span className="mono">$0.0000</span>
                  </div>
                </div>
              ),
            },
            {
              n: "02",
              t: "Wake",
              b: "Tier-3 work leases the single container. Ten agents share it, queued, instead of renting ten boxes to sit idle.",
              ui: (
                <div className="rounded-lg border p-3 text-[11px]" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                  <div className="flex justify-between" style={{ color: "var(--muted)" }}>
                    <span className="mono">tier</span>
                    <span className="mono" style={{ color: "var(--accent)" }}>T3 exec</span>
                  </div>
                  <div className="mt-2 flex justify-between" style={{ color: "var(--muted)" }}>
                    <span className="mono">lease</span>
                    <span className="mono" style={{ color: "var(--success)" }}>held</span>
                  </div>
                  <div className="mt-2 flex justify-between" style={{ color: "var(--muted)" }}>
                    <span className="mono">queue</span>
                    <span className="mono">2 waiting</span>
                  </div>
                </div>
              ),
            },
            {
              n: "03",
              t: "Prove",
              b: "The session sleeps, snapshots to git, and leaves a diff. You read the diff, not a transcript of good intentions.",
              ui: (
                <div className="rounded-lg border p-3 text-[11px]" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                  <div className="mono" style={{ color: "var(--accent)" }}>4f2a1c8</div>
                  <div className="mt-1" style={{ color: "var(--muted)" }}>wip(agent): session 4f2a1c8</div>
                  <div className="mono mt-2">
                    <span style={{ color: "var(--diff-added)" }}>+12</span>{" "}
                    <span style={{ color: "var(--diff-removed)" }}>−3</span>{" "}
                    <span style={{ color: "var(--dim)" }}>2 files</span>
                  </div>
                </div>
              ),
            },
          ].map((s) => (
            <div key={s.n}>
              <div className="mono text-xs" style={{ color: "var(--keyline)" }}>{s.n}</div>
              <h3 className="mt-2 text-lg">{s.t}</h3>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>{s.b}</p>
              <div className="mt-4">{s.ui}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* Live mini-diff */}
      <Section>
        <Eyebrow>{"// try it"}</Eyebrow>
        <h2 className="display mt-3 text-3xl">Type a diff. Watch it render.</h2>
        <p className="mt-3 max-w-2xl text-sm" style={{ color: "var(--muted)" }}>
          This is the real viewer, not a screenshot. It uses the same parser and the same theme tokens as the app, so it
          cannot claim behaviour the app does not have.
        </p>
        <div className="mt-6">
          <MiniDiff
            initial={`diff --git a/src/retry.ts b/src/retry.ts
index 1a2b3c4..5d6e7f8 100644
--- a/src/retry.ts
+++ b/src/retry.ts
@@ -14,7 +14,9 @@ export async function retry<T>(
   for (let attempt = 0; attempt < max; attempt++) {
-    try {
-      return await fn();
+    try {
+      return await fn();
+    } catch (err) {
+      if (attempt === max - 1) throw err;
     }
   }`}
          />
        </div>
      </Section>

      {/* Watch rules */}
      <Section id="rules">
        <Eyebrow>{"// watch rules"}</Eyebrow>
        <h2 className="display mt-3 text-3xl">Taste, in two files.</h2>
        <p className="mt-3 max-w-2xl text-sm" style={{ color: "var(--muted)" }}>
          <code>taste.md</code> is prose rules in plain language. <code>milo.yaml</code> is the machine half: what wakes
          the agent, what it may touch, what it must ask about.
        </p>
        <div className="mt-4 flex flex-wrap gap-3 text-xs">
          <code className="rounded px-2 py-1" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>
            milo pull <span style={{ color: "var(--dim)" }}># adopt the rules a teammate pushed</span>
          </code>
          <code className="rounded px-2 py-1" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>
            milo push <span style={{ color: "var(--dim)" }}># publish yours</span>
          </code>
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="overflow-hidden rounded-lg border" style={{ borderColor: "var(--border)" }}>
            <div className="border-b px-3 py-2 text-xs" style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--muted)" }}>
              <span className="mono">taste.md</span>
            </div>
            <pre className="mono overflow-auto p-3 text-[11px] leading-relaxed" style={{ background: "var(--surface)", color: "var(--foreground)" }}>
              {WATCH_RULES_TASTE}
            </pre>
          </div>
          <div className="overflow-hidden rounded-lg border" style={{ borderColor: "var(--border)" }}>
            <div className="border-b px-3 py-2 text-xs" style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--muted)" }}>
              <span className="mono">milo.yaml</span>
            </div>
            <pre className="mono overflow-auto p-3 text-[11px] leading-relaxed" style={{ background: "var(--surface)", color: "var(--foreground)" }}>
              {WATCH_RULES_YAML}
            </pre>
          </div>
        </div>
      </Section>

      {/* Milo vs generic */}
      <Section>
        <Eyebrow>{"// the difference"}</Eyebrow>
        <h2 className="display mt-3 text-3xl">Slop, and taste.</h2>
        <p className="mt-3 max-w-2xl text-sm" style={{ color: "var(--muted)" }}>
          No competitor is named here, because the comparison is between behaviours and not products.
        </p>
        <div className="mt-6 overflow-hidden rounded-lg border" style={{ borderColor: "var(--border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--surface-2)" }}>
                <th className="px-4 py-2 text-left text-xs font-medium" style={{ color: "var(--danger)" }}>Slop</th>
                <th className="px-4 py-2 text-left text-xs font-medium" style={{ color: "var(--success)" }}>Taste</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map(([a, b]) => (
                <tr key={a} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="px-4 py-2.5 text-xs" style={{ color: "var(--muted)" }}>{a}</td>
                  <td className="px-4 py-2.5 text-xs">{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Quotes. Placeholder-free: these slots are empty on purpose until real
          people say real things. A fake quote costs more than a missing one. */}
      <Section>
        <Eyebrow>{"// what people say"}</Eyebrow>
        <h2 className="display mt-3 text-3xl">Quotes go here.</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg border border-dashed p-5" style={{ borderColor: "var(--border)" }}>
              <p className="text-sm" style={{ color: "var(--dim)" }}>
                Reserved. This slot stays empty until a real person says a real thing, with a real name and permission on
                file.
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* Pricing, open source, themes */}
      <Section id="pricing">
        <Eyebrow>{"// pricing"}</Eyebrow>
        <h2 className="display mt-3 text-3xl">$5 base. $7.02 for the workload in the brief.</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <div className="mono text-2xl">$5.00</div>
            <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>Workers Paid base plan</p>
            <Meander />
            <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
              100 container-hours included. 3,000 agent-hours does not fit inside that, and Milo does not pretend it does.
            </p>
          </div>
          <div className="rounded-lg border p-5" style={{ borderColor: "var(--accent)", background: "var(--surface)" }}>
            <div className="mono text-2xl">$7.02</div>
            <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>3,000 agent-hours, 30/30/20/20 mix</p>
            <Meander />
            <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
              Lite instance, one container leased and queued, 60s sleep tail, 60% of tests offloaded to isolates.
            </p>
            <a href="https://github.com/kartikkabadi/milo/blob/main/COST_MODEL.md" className="mt-3 inline-block text-xs underline decoration-dotted" style={{ color: "var(--accent)" }}>
              The arithmetic
            </a>
          </div>
          <div className="rounded-lg border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <div className="mono text-2xl">$24.01</div>
            <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>the naive version</p>
            <Meander />
            <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
              What it costs if every test wakes the container and the 60s tail is paid 82 times an hour. The container
              never sleeps.
            </p>
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border p-5" style={{ borderColor: "var(--border)" }}>
            <h3 className="text-sm">Open source</h3>
            <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
              No license file, by request. The code is MIT-able: no copyleft dependencies, no vendored code, no secrets.
              Add a LICENSE if you want one.
            </p>
            <a href="https://github.com/kartikkabadi/milo" className="mt-3 inline-block text-xs underline decoration-dotted" style={{ color: "var(--accent)" }}>
              github.com/kartikkabadi/milo
            </a>
          </div>
          <div className="rounded-lg border p-5" style={{ borderColor: "var(--border)" }} id="themes">
            <h3 className="text-sm">Seven themes</h3>
            <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
              Two defaults, four alternates, one warning. Open the menu in the header and click through them on this page
              — the CSS variables are the same ones the app uses.
            </p>
            <div className="mt-3">
              <ThemeMenu />
            </div>
          </div>
        </div>
      </Section>

      {/* FAQ */}
      <Section>
        <Eyebrow>{"// questions"}</Eyebrow>
        <h2 className="display mt-3 text-3xl">Six answers.</h2>
        <div className="mt-6 divide-y" style={{ borderColor: "var(--border)" }}>
          {FAQ.map((f) => (
            <details key={f.q} className="group py-4">
              <summary className="cursor-pointer list-none text-sm" style={{ color: "var(--foreground)" }}>
                <span className="mr-2 inline-block transition-transform group-open:rotate-90" style={{ color: "var(--accent)" }}>
                  ›
                </span>
                {f.q}
              </summary>
              <p className="mt-2 pl-5 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
                {f.a}
              </p>
            </details>
          ))}
        </div>
      </Section>

      {/* Footer */}
      <footer className="border-t" style={{ borderColor: "var(--border)" }}>
        <div className="meander" />
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span style={{ color: "var(--muted)" }}>
              <Wordmark height={18} />
            </span>
            <p className="mt-2 text-xs" style={{ color: "var(--dim)" }}>the friend that minds your agents</p>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs" style={{ color: "var(--muted)" }}>
            <a href="https://github.com/kartikkabadi/milo/tree/main/brand">Brand assets</a>
            <a href="https://github.com/kartikkabadi/milo/blob/main/CHANGELOG.md">Changelog</a>
            <a href="https://github.com/kartikkabadi/milo#readme">Docs</a>
            <a href="https://github.com/kartikkabadi/milo">GitHub</a>
            <a href="https://github.com/kartikkabadi/milo/blob/main/COST_MODEL.md">Cost model</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
