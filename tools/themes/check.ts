/**
 * Drift checks.
 *
 * Three things in this repo are duplicated on purpose, and each one is a place
 * a bug can hide:
 *
 *   1. The theme bootstrap script lives in index.html (must be inline to beat
 *      first paint) and in src/lib/themes.ts (so the runtime and the bootstrap
 *      cannot disagree about the theme list).
 *   2. The theme metadata lives in the generated bundle and in the Worker's
 *      routes/themes.ts (the Worker must not import the generator).
 *   3. The Pi themes must keep all 53 required tokens.
 *
 * This script fails loudly on all three. Run it in CI, or before a release.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { paletteList, emitPi } from "../../packages/theme-kit/src/emit.ts";

const root = resolve(import.meta.dirname, "../..");
let failures = 0;

const fail = (msg: string) => {
  failures++;
  process.stderr.write(`FAIL  ${msg}\n`);
};
const pass = (msg: string) => process.stdout.write(`ok    ${msg}\n`);

/* 1. Bootstrap script drift. */
try {
  const html = await readFile(resolve(root, "apps/web/index.html"), "utf8");
  const themesTs = await readFile(resolve(root, "apps/web/src/lib/themes.ts"), "utf8");
  const bootstrapTs = await readFile(resolve(root, "apps/web/src/lib/bootstrap.ts"), "utf8");

  const idsInHtml = [...html.matchAll(/"([a-z-]+)":\s*\d/g)].map((m) => m[1]);
  const expected = paletteList.map((p) => p.id);
  const missing = expected.filter((id) => !idsInHtml.includes(id));
  if (missing.length) fail(`index.html bootstrap is missing themes: ${missing.join(", ")}`);
  else pass(`index.html bootstrap covers all ${expected.length} themes`);

  for (const [name, src] of [
    ["themes.ts", themesTs],
    ["bootstrap.ts", bootstrapTs],
  ] as const) {
    for (const id of expected) {
      if (!src.includes(`"${id}"`)) fail(`${name} does not mention theme ${id}`);
    }
  }
  if (!failures) pass("bootstrap string present in themes.ts and bootstrap.ts");
} catch (err) {
  fail(`could not read bootstrap sources: ${String(err)}`);
}

/* 2. Worker theme metadata drift. */
try {
  const workerThemes = await readFile(resolve(root, "workers/api/src/routes/themes.ts"), "utf8");
  for (const p of paletteList) {
    if (!workerThemes.includes(`"${p.id}"`)) fail(`workers/api/src/routes/themes.ts is missing ${p.id}`);
    // The swatch accent is the one value the GUI reads before it has any CSS.
    if (!workerThemes.includes(p.accent)) {
      fail(`worker theme ${p.id} swatch accent ${p.accent} is not present`);
    }
  }
  if (!failures) pass("worker theme metadata matches the palette source");
} catch (err) {
  fail(`could not read worker theme metadata: ${String(err)}`);
}

/* 3. Pi token completeness. */
const PI_REQUIRED = [
  "accent", "border", "borderAccent", "borderMuted", "success", "error", "warning", "muted", "dim", "text",
  "thinkingText", "scrollbarTrack", "scrollbarThumb",
  "selectedBg", "userMessageBg", "userMessageText", "customMessageBg", "customMessageText", "customMessageLabel",
  "toolPendingBg", "toolSuccessBg", "toolErrorBg", "toolTitle", "toolOutput",
  "mdHeading", "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock", "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder",
  "mdHr", "mdListBullet",
  "toolDiffAdded", "toolDiffRemoved", "toolDiffContext",
  "syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable", "syntaxString", "syntaxNumber",
  "syntaxType", "syntaxOperator", "syntaxPunctuation",
  "thinkingOff", "thinkingMinimal", "thinkingLow", "thinkingMedium", "thinkingHigh", "thinkingXhigh",
  "bashMode",
];

let tokenFailures = 0;
for (const p of paletteList) {
  const theme = emitPi(p);
  const missing = PI_REQUIRED.filter((k) => !(k in theme.colors));
  const badHex = Object.entries(theme.colors).filter(([, v]) => v !== "" && !/^#[0-9A-Fa-f]{6}$/.test(v) && !(v in theme.vars));
  if (missing.length) {
    fail(`pi theme ${p.id} is missing ${missing.length} required tokens: ${missing.slice(0, 5).join(", ")}…`);
    tokenFailures++;
  }
  if (badHex.length) {
    fail(`pi theme ${p.id} has unparseable colours: ${badHex.map(([k]) => k).join(", ")}`);
    tokenFailures++;
  }
}
if (!tokenFailures) {
  pass(`all ${paletteList.length} Pi themes carry ${PI_REQUIRED.length} required tokens with valid colours`);
}

process.stdout.write(`\n${failures === 0 ? "drift check passed" : `${failures} drift failure(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);
