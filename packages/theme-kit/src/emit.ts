import type { Palette, ThemeId } from "./palettes.ts";
import { palettes, paletteList, THEME_IDS } from "./palettes.ts";

export const PI_SCHEMA =
  "https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json";
export const OPENCODE_SCHEMA = "https://opencode.ai/theme.json";

/* ------------------------------------------------------------------ *
 * Pi
 *
 * Pi requires all 53 tokens. Three more are optional with documented
 * fallbacks; we emit them anyway so the theme is fully specified.
 *   thinkingMax      -> falls back to thinkingXhigh
 *   searchMatchBg    -> falls back to selectedBg
 *   searchMatchText  -> falls back to text
 * ------------------------------------------------------------------ */

export type PiTheme = {
  $schema: string;
  name: string;
  vars: Record<string, string>;
  colors: Record<string, string>;
  export: { pageBg: string; cardBg: string; infoBg: string };
};

export function emitPi(p: Palette): PiTheme {
  const k = p.keyline ?? p.accent2;

  const colors: Record<string, string> = {
    /* Core UI (13) */
    accent: p.accent,
    border: p.border,
    borderAccent: p.borderAccent,
    borderMuted: p.border,
    success: p.success,
    error: p.danger,
    warning: p.warn,
    muted: p.muted,
    dim: p.dim,
    text: p.text,
    thinkingText: p.dim,
    scrollbarTrack: p.surface2,
    scrollbarThumb: p.borderAccent,

    /* Backgrounds & Content (11 required, 2 optional) */
    selectedBg: p.surface2,
    searchMatchBg: p.surface2,
    searchMatchText: p.text,
    userMessageBg: p.surface,
    userMessageText: p.text,
    customMessageBg: p.surface,
    customMessageText: p.text,
    customMessageLabel: p.accent,
    toolPendingBg: p.diff.pendingBg,
    toolSuccessBg: p.diff.addedBg,
    toolErrorBg: p.diff.removedBg,
    toolTitle: p.accent,
    toolOutput: p.muted,

    /* Markdown (10) */
    mdHeading: p.text,
    mdLink: p.accent,
    mdLinkUrl: p.dim,
    mdCode: p.syntax.string,
    mdCodeBlock: p.syntax.variable,
    mdCodeBlockBorder: p.border,
    mdQuote: p.muted,
    mdQuoteBorder: p.borderAccent,
    mdHr: p.border,
    mdListBullet: p.accent,

    /* Tool Diffs (3) */
    toolDiffAdded: p.diff.added,
    toolDiffRemoved: p.diff.removed,
    toolDiffContext: p.diff.context,

    /* Syntax Highlighting (9) */
    syntaxComment: p.syntax.comment,
    syntaxKeyword: p.syntax.keyword,
    syntaxFunction: p.syntax.func,
    syntaxVariable: p.syntax.variable,
    syntaxString: p.syntax.string,
    syntaxNumber: p.syntax.number,
    syntaxType: p.syntax.type,
    syntaxOperator: p.syntax.operator,
    syntaxPunctuation: p.syntax.punctuation,

    /* Thinking Level Borders (6 required, 1 optional) */
    thinkingOff: p.border,
    thinkingMinimal: p.dim,
    thinkingLow: p.accent2,
    thinkingMedium: p.accent,
    thinkingHigh: k,
    thinkingXhigh: p.warn,
    thinkingMax: p.danger,

    /* Bash Mode (1) */
    bashMode: p.success,
  };

  return {
    $schema: PI_SCHEMA,
    name: p.id,
    vars: {
      bg: p.bg,
      surface: p.surface,
      surface2: p.surface2,
      border: p.border,
      borderAccent: p.borderAccent,
      text: p.text,
      muted: p.muted,
      dim: p.dim,
      accent: p.accent,
      accent2: p.accent2,
      success: p.success,
      warn: p.warn,
      danger: p.danger,
      info: p.info,
      keyline: k,
      comment: p.syntax.comment,
      keyword: p.syntax.keyword,
      func: p.syntax.func,
      variable: p.syntax.variable,
      string: p.syntax.string,
      number: p.syntax.number,
      type: p.syntax.type,
      added: p.diff.added,
      removed: p.diff.removed,
      addedBg: p.diff.addedBg,
      removedBg: p.diff.removedBg,
      pendingBg: p.diff.pendingBg,
    },
    colors,
    export: {
      pageBg: p.bg,
      cardBg: p.surface,
      infoBg: p.surface2,
    },
  };
}

/* ------------------------------------------------------------------ *
 * OpenCode
 *
 * `defs` holds the palette; `theme` maps each UI token onto a def. A
 * single-mode theme file uses flat refs. The combined file uses
 * {dark, light} variants so one theme follows the terminal background.
 * ------------------------------------------------------------------ */

export type OpenCodeTheme = {
  $schema: string;
  name: string;
  defs: Record<string, string>;
  theme: Record<string, string | { dark: string; light: string }>;
};

/** Flat `defs` for one palette. Names are namespaced so two palettes can merge. */
function defsFor(p: Palette, prefix = ""): Record<string, string> {
  const n = (s: string) => `${prefix}${s}`;
  const k = p.keyline ?? p.accent2;
  return {
    [n("bg")]: p.bg,
    [n("surface")]: p.surface,
    [n("surface2")]: p.surface2,
    [n("border")]: p.border,
    [n("borderAccent")]: p.borderAccent,
    [n("text")]: p.text,
    [n("muted")]: p.muted,
    [n("dim")]: p.dim,
    [n("accent")]: p.accent,
    [n("accent2")]: p.accent2,
    [n("success")]: p.success,
    [n("warn")]: p.warn,
    [n("danger")]: p.danger,
    [n("info")]: p.info,
    [n("keyline")]: k,
    [n("comment")]: p.syntax.comment,
    [n("keyword")]: p.syntax.keyword,
    [n("func")]: p.syntax.func,
    [n("variable")]: p.syntax.variable,
    [n("string")]: p.syntax.string,
    [n("number")]: p.syntax.number,
    [n("type")]: p.syntax.type,
    [n("operator")]: p.syntax.operator,
    [n("punctuation")]: p.syntax.punctuation,
    [n("added")]: p.diff.added,
    [n("removed")]: p.diff.removed,
    [n("context")]: p.diff.context,
    [n("addedBg")]: p.diff.addedBg,
    [n("removedBg")]: p.diff.removedBg,
    [n("pendingBg")]: p.diff.pendingBg,
  };
}

/**
 * Maps an OpenCode UI token name onto a `defs` key. Kept as data so the
 * combined and single-mode emitters cannot drift apart.
 */
const OPENCODE_TOKEN_MAP: Record<string, string> = {
  primary: "accent",
  secondary: "accent2",
  accent: "accent",
  error: "danger",
  warning: "warn",
  success: "success",
  info: "info",

  text: "text",
  textMuted: "muted",
  textDim: "dim",
  background: "bg",
  backgroundPanel: "surface",
  backgroundElement: "surface2",
  border: "border",
  borderActive: "borderAccent",
  borderSubtle: "border",

  diffAdded: "added",
  diffRemoved: "removed",
  diffContext: "context",
  diffAddedBg: "addedBg",
  diffRemovedBg: "removedBg",
  diffContextBg: "pendingBg",
  diffAddedLineNumberBg: "addedBg",
  diffRemovedLineNumberBg: "removedBg",
  diffContextLineNumberBg: "pendingBg",
  diffHunkHeader: "muted",
  diffHighlightAdded: "added",
  diffHighlightRemoved: "removed",

  markdownText: "text",
  markdownHeading: "text",
  markdownLink: "accent",
  markdownLinkText: "accent",
  markdownCode: "string",
  markdownBlockQuote: "muted",
  markdownEmph: "accent2",
  markdownStrong: "text",
  markdownHorizontalRule: "border",
  markdownListItem: "text",
  markdownListItemBullet: "accent",

  syntaxComment: "comment",
  syntaxKeyword: "keyword",
  syntaxFunction: "func",
  syntaxVariable: "variable",
  syntaxString: "string",
  syntaxNumber: "number",
  syntaxType: "type",
  syntaxOperator: "operator",
  syntaxPunctuation: "punctuation",
};

export function emitOpenCodeSingle(p: Palette): OpenCodeTheme {
  const theme: Record<string, string> = {};
  for (const [token, key] of Object.entries(OPENCODE_TOKEN_MAP)) {
    theme[token] = key;
  }
  return {
    $schema: OPENCODE_SCHEMA,
    name: p.id,
    defs: defsFor(p),
    theme,
  };
}

/**
 * `milo-greek` — one file, two modes. Dark resolves to Spartan Night,
 * light to Hellas Marble. This is the file that follows the terminal
 * background, which is the behaviour most people actually want.
 */
export function emitOpenCodeGreek(): OpenCodeTheme {
  const dark = palettes["spartan-night"];
  const light = palettes["hellas-marble"];
  const theme: Record<string, { dark: string; light: string }> = {};
  for (const [token, key] of Object.entries(OPENCODE_TOKEN_MAP)) {
    theme[token] = { dark: `d_${key}`, light: `l_${key}` };
  }
  return {
    $schema: OPENCODE_SCHEMA,
    name: "milo-greek",
    defs: { ...defsFor(dark, "d_"), ...defsFor(light, "l_") },
    theme,
  };
}

/* ------------------------------------------------------------------ *
 * xterm.js
 * ------------------------------------------------------------------ */

export interface XtermTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

/** Explicit per-theme xterm overrides where the derivation would be wrong. */
const XTERM_OVERRIDES: Partial<Record<ThemeId, Partial<XtermTheme>>> = {
  // Matches the reference given in the brief exactly.
  "spartan-night": {
    selectionBackground: "#3A2E22",
    magenta: "#C9A227",
    cyan: "#8ABEB7",
  },
  "halo-ring": {
    selectionBackground: "#141F3D",
    magenta: "#7DD3FC",
    cyan: "#2B4CFF",
  },
};

export function emitXterm(p: Palette): XtermTheme {
  const base: XtermTheme = {
    background: p.bg,
    foreground: p.text,
    cursor: p.accent,
    cursorAccent: p.bg,
    selectionBackground: p.surface2,
    black: p.border,
    red: p.danger,
    green: p.success,
    yellow: p.warn,
    blue: p.info,
    magenta: p.keyline ?? p.accent2,
    cyan: p.accent2,
    white: p.muted,
    brightBlack: p.dim,
    brightRed: p.danger,
    brightGreen: p.success,
    brightYellow: p.warn,
    brightBlue: p.accent,
    brightMagenta: p.accent2,
    brightCyan: p.accent2,
    brightWhite: p.text,
  };
  return { ...base, ...(XTERM_OVERRIDES[p.id] ?? {}) };
}

/* ------------------------------------------------------------------ *
 * Web CSS
 *
 * Tailwind v4. `:root` is Hellas Marble, `.dark` is Spartan Night, and
 * every other theme is a `[data-theme=...]` override. Legacy milo-dark /
 * milo-light classes keep working.
 * ------------------------------------------------------------------ */

function cssVars(p: Palette, indent = "  "): string {
  const k = p.keyline ?? p.accent2;
  const pairs: [string, string][] = [
    ["background", p.bg],
    ["foreground", p.text],
    ["card", p.surface],
    ["card-foreground", p.text],
    ["popover", p.surface],
    ["popover-foreground", p.text],
    ["primary", p.accent],
    ["primary-foreground", p.mode === "dark" ? p.bg : "#ffffff"],
    ["secondary", p.surface2],
    ["secondary-foreground", p.text],
    ["muted", p.surface2],
    ["muted-foreground", p.muted],
    ["accent", p.accent],
    ["accent-foreground", p.mode === "dark" ? p.bg : "#ffffff"],
    ["destructive", p.danger],
    ["destructive-foreground", p.mode === "dark" ? p.bg : "#ffffff"],
    ["border", p.border],
    ["input", p.border],
    ["ring", p.accent],
    ["surface", p.surface],
    ["surface-2", p.surface2],
    ["border-accent", p.borderAccent],
    ["text-muted", p.muted],
    ["text-dim", p.dim],
    ["accent-2", p.accent2],
    ["success", p.success],
    ["warn", p.warn],
    ["danger", p.danger],
    ["info", p.info],
    ["keyline", k],
    ["syntax-comment", p.syntax.comment],
    ["syntax-keyword", p.syntax.keyword],
    ["syntax-func", p.syntax.func],
    ["syntax-var", p.syntax.variable],
    ["syntax-string", p.syntax.string],
    ["syntax-number", p.syntax.number],
    ["syntax-type", p.syntax.type],
    ["syntax-op", p.syntax.operator],
    ["syntax-punct", p.syntax.punctuation],
    ["diff-added", p.diff.added],
    ["diff-removed", p.diff.removed],
    ["diff-context", p.diff.context],
    ["diff-added-bg", p.diff.addedBg],
    ["diff-removed-bg", p.diff.removedBg],
    ["diff-pending-bg", p.diff.pendingBg],
  ];
  return pairs.map(([name, value]) => `${indent}--${name}: ${value};`).join("\n");
}

export function emitWebCss(): string {
  const marble = palettes["hellas-marble"];
  const spartan = palettes["spartan-night"];

  const blocks = paletteList
    .filter((p) => p.id !== "hellas-marble" && p.id !== "spartan-night")
    .map(
      (p) => `/* ${p.label} — ${p.blurb} */
[data-theme="${p.id}"] {
${cssVars(p)}
}`,
    )
    .join("\n\n");

  return `/*
 * Milo web tokens. GENERATED by packages/theme-kit — do not hand-edit.
 *
 * :root          -> Hellas Marble (light default)
 * .dark          -> Spartan Night (dark default)
 * [data-theme=*] -> every other theme, plus legacy milo-dark / milo-light
 *
 * One accent per theme. \`primary\` is the accent. Nothing else is.
 */

@custom-variant dark (&:is(.dark *));

:root {
${cssVars(marble)}
  --radius: 0.5rem;
  /* Fluting: vertical rhythm. 4px base, used by sidebar + cards. */
  --flute: 4px;
  color-scheme: light;
}

.dark {
${cssVars(spartan)}
  color-scheme: dark;
}

${blocks}

/* Legacy aliases. Both original themes remain selectable. */
[data-theme="milo-dark"] {
${cssVars(palettes["milo-dark"])}
  color-scheme: dark;
}

[data-theme="milo-light"] {
${cssVars(palettes["milo-light"])}
  color-scheme: light;
}

/* Forge Red is danger-only. The GUI gates selection; the CSS only warns. */
[data-theme="forge-red"] {
${cssVars(palettes["forge-red"])}
  color-scheme: dark;
}
`;
}

/**
 * Command Code has no custom theme JSON. It ships exactly three values —
 * `dark`, `light`, `auto` — so Milo maps its seven themes onto those three and
 * does not pretend to do more. `auto` follows the terminal background via
 * OSC-11 detection.
 *
 * The mapping is emitted rather than inlined so the GUI, the CLI, and the
 * harness adapter cannot disagree about what "Spartan Night" means to `cmd`.
 */
export function commandCodeTheme(p: Palette): { theme: "dark" | "light" | "auto"; note: string } {
  if (p.mode === "light") {
    return {
      theme: "light",
      note: `${p.label} is a light theme, so Command Code gets \`--theme light\`. Milo ships no custom JSON for cmd.`,
    };
  }
  return {
    theme: "dark",
    note: `${p.label} is a dark theme, so Command Code gets \`--theme dark\`. Dark is designed here, not inverted.`,
  };
}

/** Every artifact the theme CLI writes, as path -> contents. */
export function emitAll(): Record<string, string> {
  const out: Record<string, string> = {};

  out["themes/pi/index.json"] = JSON.stringify(
    {
      $schema: PI_SCHEMA,
      themes: paletteList.map((p) => ({
        id: p.id,
        label: p.label,
        mode: p.mode,
        file: `${p.id}.json`,
        default: p.defaultFor ?? null,
        danger: Boolean(p.isDanger),
      })),
    },
    null,
    2,
  );

  for (const p of paletteList) {
    out[`themes/pi/${p.id}.json`] = JSON.stringify(emitPi(p), null, 2);
    out[`themes/xterm/${p.id}.json`] = JSON.stringify(emitXterm(p), null, 2);
    out[`themes/opencode/${p.id}.json`] = JSON.stringify(emitOpenCodeSingle(p), null, 2);
  }

  out["themes/opencode/milo-greek.json"] = JSON.stringify(emitOpenCodeGreek(), null, 2);

  out["themes/opencode/tui.json"] = JSON.stringify(
    {
      $schema: "https://opencode.ai/tui.json",
      theme: "milo-greek",
    },
    null,
    2,
  );

  out["themes/opencode/opencode.json"] = JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      $comment:
        "Milo's OpenCode defaults. Plan/Explore/Scout are read-only tiers; Build is the only agent allowed to touch the filesystem, and it runs inside the Tier-3 sandbox.",
      permission: {
        "*": "deny",
        read: { "*": "allow", "*.env": "deny", "*.env.*": "deny", "*.env.example": "allow" },
        glob: "allow",
        grep: "allow",
        edit: "ask",
        bash: { "*": "ask", "git status*": "allow", "git diff*": "allow", "git log*": "allow", "rm -rf *": "deny" },
        webfetch: "ask",
        websearch: "ask",
        task: "allow",
        question: "allow",
      },
      agent: {
        plan: { mode: "primary", permission: { edit: "deny", bash: "deny" } },
        explore: { mode: "subagent", permission: { edit: "deny", bash: "deny", webfetch: "deny" } },
        scout: { mode: "subagent", permission: { edit: "deny", bash: "deny", webfetch: "deny" } },
        build: { mode: "primary", permission: { edit: "ask", bash: "ask" } },
      },
    },
    null,
    2,
  );

  out["themes/web.css"] = emitWebCss();

  // A single bundle the Worker imports and writes into a sandbox at launch.
  // This is why the container image does not need the themes baked in: the
  // deployed Worker is the source of truth, so a theme can never drift from
  // the harness config that references it.
  out["themes/bundle.json"] = JSON.stringify(
    {
      note: "GENERATED. The Worker writes these into the sandbox at launch so themes always match the deployed version.",
      pi: Object.fromEntries(paletteList.map((p) => [p.id, emitPi(p)])),
      xterm: Object.fromEntries(paletteList.map((p) => [p.id, emitXterm(p)])),
      opencode: Object.fromEntries(paletteList.map((p) => [p.id, emitOpenCodeSingle(p)])),
      opencodeGreek: emitOpenCodeGreek(),
      commandCode: Object.fromEntries(paletteList.map((p) => [p.id, commandCodeTheme(p)])),
    },
    null,
    2,
  );

  // The CLI is published as a standalone package, so it cannot reach outside
  // its own directory at runtime. This copy is what `npm i -g milo` ships.
  out["packages/milo-cli/themes/bundle.json"] = out["themes/bundle.json"];

  out["themes/themes.json"] = JSON.stringify(
    {
      generated: "packages/theme-kit/src/palettes.ts",
      note: "Do not hand-edit any file under themes/. Edit the palette source and run `npm run themes`.",
      themes: paletteList.map((p) => ({
        id: p.id,
        label: p.label,
        mode: p.mode,
        blurb: p.blurb,
        defaultFor: p.defaultFor ?? null,
        danger: Boolean(p.isDanger),
        artifacts: {
          pi: `themes/pi/${p.id}.json`,
          opencode: `themes/opencode/${p.id}.json`,
          xterm: `themes/xterm/${p.id}.json`,
        },
      })),
    },
    null,
    2,
  );

  return out;
}

export { THEME_IDS, palettes, paletteList };
