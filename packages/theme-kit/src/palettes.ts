/**
 * The one palette source.
 *
 * Every theme artifact in this repo — Pi JSON, OpenCode JSON, xterm ITheme,
 * web CSS variables — is generated from these objects. Nothing is hand-edited
 * downstream. If a colour is wrong, it is wrong here and only here.
 *
 * Rules encoded in this file:
 *   - One accent per theme. `accent` is actions, cursor, links. Nothing else.
 *   - Dark themes use a warm off-black, never pure black. The single exception
 *     is Halo Ring, which is a void by design.
 *   - Forge Red is a danger theme. It ships, it is never the default, and the
 *     GUI refuses to select it without an explicit confirmation.
 */

/** A slot is a hex string, or the empty string meaning "terminal default". */
export type Slot = string;

export interface Palette {
  /** Stable id. Also the file basename for every emitted artifact. */
  id: ThemeId;
  /** Human label shown in the GUI theme menu. */
  label: string;
  /** `dark` or `light`. Drives prefers-color-scheme matching and xterm defaults. */
  mode: "dark" | "light";
  /** One line for the theme menu tooltip. */
  blurb: string;
  /**
   * True only for Forge Red. The GUI gates selection behind a confirm.
   *
   * Named `isDanger` and not `danger` because `danger` is already the semantic
   * colour slot, and a palette that declares `danger` twice is a palette where
   * `p.danger` is a boolean in one place and a hex string in another. That
   * collision was in an earlier draft and this is the fix.
   */
  isDanger?: boolean;
  /** True for the two defaults the GUI offers on first run. */
  defaultFor?: "dark" | "light";

  /** Surfaces, from furthest back to nearest. */
  bg: Slot;
  surface: Slot;
  surface2: Slot;

  /** Borders. `border` is the muted everyday line, `borderAccent` is the strong one. */
  border: Slot;
  borderAccent: Slot;

  /** Type. */
  text: Slot;
  muted: Slot;
  dim: Slot;

  /** Exactly one accent, plus one supporting accent2 for inline/secondary use. */
  accent: Slot;
  accent2: Slot;

  /** Semantic. */
  success: Slot;
  warn: Slot;
  danger: Slot;
  info: Slot;

  /** Optional metallic key-line colour. Greek key dividers and success ticks only. */
  keyline?: Slot;

  syntax: {
    comment: Slot;
    keyword: Slot;
    func: Slot;
    variable: Slot;
    string: Slot;
    number: Slot;
    type: Slot;
    operator: Slot;
    punctuation: Slot;
  };

  diff: {
    added: Slot;
    removed: Slot;
    context: Slot;
    addedBg: Slot;
    removedBg: Slot;
    pendingBg: Slot;
  };
}

export const THEME_IDS = [
  "hellas-marble",
  "spartan-night",
  "milo-dark",
  "milo-light",
  "ion-purple",
  "halo-ring",
  "forge-red",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const palettes: Record<ThemeId, Palette> = {
  /* ------------------------------------------------------------------ *
   * Hellas Marble — light default.
   * Marble + law + agora. Innocent, light, real. Reading beats writing.
   * ------------------------------------------------------------------ */
  "hellas-marble": {
    id: "hellas-marble",
    label: "Hellas Marble",
    mode: "light",
    blurb: "Aegean blue on marble. The default daylight theme.",
    defaultFor: "light",
    bg: "#F5F1E8",
    surface: "#EDE6D6",
    surface2: "#E3D9C2",
    border: "#D6CBB2",
    borderAccent: "#8A8578",
    text: "#1E1C18",
    muted: "#6B675F",
    dim: "#8A8578",
    accent: "#3A7BD5",
    accent2: "#6B7C4A",
    success: "#4A7C3A",
    warn: "#9A6700",
    danger: "#B3261E",
    info: "#3A7BD5",
    keyline: "#C9A227",
    syntax: {
      comment: "#8A8578",
      keyword: "#3A7BD5",
      func: "#1D5FBF",
      variable: "#1E1C18",
      string: "#4A7C3A",
      number: "#9A6700",
      type: "#6B7C4A",
      operator: "#6B675F",
      punctuation: "#6B675F",
    },
    diff: {
      added: "#4A7C3A",
      removed: "#B3261E",
      context: "#8A8578",
      addedBg: "#E2EAD8",
      removedBg: "#F3D9D4",
      pendingBg: "#EDE6D6",
    },
  },

  /* ------------------------------------------------------------------ *
   * Spartan Night — dark default.
   * Torch + bronze, kept calm and lawful. We stole the light, not the army.
   * ------------------------------------------------------------------ */
  "spartan-night": {
    id: "spartan-night",
    label: "Spartan Night",
    mode: "dark",
    blurb: "Torchlight on charcoal. The default torch-dark theme.",
    defaultFor: "dark",
    bg: "#0C0A08",
    surface: "#1A1512",
    surface2: "#241C15",
    border: "#2A2420",
    borderAccent: "#8C6A3C",
    text: "#EDE6D6",
    muted: "#A8A29A",
    dim: "#6B675F",
    accent: "#E86A1F",
    accent2: "#F59E0B",
    success: "#3ECF8E",
    warn: "#F59E0B",
    danger: "#F87171",
    info: "#7FB2E5",
    keyline: "#8C6A3C",
    syntax: {
      comment: "#6B675F",
      keyword: "#E8B04B",
      func: "#F59E0B",
      variable: "#EDE6D6",
      string: "#3ECF8E",
      number: "#E86A1F",
      type: "#7FB2E5",
      operator: "#A8A29A",
      punctuation: "#A8A29A",
    },
    diff: {
      added: "#3ECF8E",
      removed: "#F87171",
      context: "#6B675F",
      addedBg: "#1E2E22",
      removedBg: "#331917",
      pendingBg: "#241C15",
    },
  },

  /* ------------------------------------------------------------------ *
   * Milo Dark — original default, still shipped.
   * ------------------------------------------------------------------ */
  "milo-dark": {
    id: "milo-dark",
    label: "Milo Dark",
    mode: "dark",
    blurb: "The original. Cool blue on ink.",
    bg: "#1a1b26",
    surface: "#1e1e2e",
    surface2: "#24283b",
    border: "#313244",
    borderAccent: "#45475a",
    text: "#cdd6f4",
    muted: "#a6adc8",
    dim: "#585b70",
    accent: "#7aa2f7",
    accent2: "#94e2d5",
    success: "#a6e3a1",
    warn: "#f9e2af",
    danger: "#f38ba8",
    info: "#89b4fa",
    syntax: {
      comment: "#6272a4",
      keyword: "#bb9af7",
      func: "#7dcfff",
      variable: "#cdd6f4",
      string: "#9ece6a",
      number: "#fab387",
      type: "#94e2d5",
      operator: "#bac2de",
      punctuation: "#bac2de",
    },
    diff: {
      added: "#a6e3a1",
      removed: "#f38ba8",
      context: "#6c7086",
      addedBg: "#283228",
      removedBg: "#3c2828",
      pendingBg: "#282832",
    },
  },

  /* ------------------------------------------------------------------ *
   * Milo Light — original, still shipped.
   * ------------------------------------------------------------------ */
  "milo-light": {
    id: "milo-light",
    label: "Milo Light",
    mode: "light",
    blurb: "The original daylight. Plain paper.",
    bg: "#ffffff",
    surface: "#f6f8fa",
    surface2: "#eaeef2",
    border: "#d0d7de",
    borderAccent: "#8b949e",
    text: "#1f2328",
    muted: "#57606a",
    dim: "#8b949e",
    accent: "#0969da",
    accent2: "#0a7ea4",
    success: "#1a7f37",
    warn: "#9a6700",
    danger: "#d1242f",
    info: "#0969da",
    syntax: {
      comment: "#8b949e",
      keyword: "#0969da",
      func: "#0a7ea4",
      variable: "#1f2328",
      string: "#1a7f37",
      number: "#9a6700",
      type: "#0a7ea4",
      operator: "#57606a",
      punctuation: "#57606a",
    },
    diff: {
      added: "#1a7f37",
      removed: "#d1242f",
      context: "#8b949e",
      addedBg: "#e6ffec",
      removedBg: "#ffebe9",
      pendingBg: "#f6f8fa",
    },
  },

  /* ------------------------------------------------------------------ *
   * Ion Purple — alt dark. Black-violet, indigo top.
   * ------------------------------------------------------------------ */
  "ion-purple": {
    id: "ion-purple",
    label: "Ion Purple",
    mode: "dark",
    blurb: "Black-violet at the top, ionising downward.",
    bg: "#0A0618",
    surface: "#150E2E",
    surface2: "#1E1440",
    border: "#2E1F5C",
    borderAccent: "#7C3AED",
    text: "#EDE9FE",
    muted: "#B7A8F5",
    dim: "#6D6390",
    accent: "#8B5CF6",
    accent2: "#C4B5FD",
    success: "#34D399",
    warn: "#FBBF24",
    danger: "#F87171",
    info: "#A78BFA",
    syntax: {
      comment: "#6D6390",
      keyword: "#C4B5FD",
      func: "#A78BFA",
      variable: "#EDE9FE",
      string: "#34D399",
      number: "#FBBF24",
      type: "#7C3AED",
      operator: "#B7A8F5",
      punctuation: "#B7A8F5",
    },
    diff: {
      added: "#34D399",
      removed: "#F87171",
      context: "#6D6390",
      addedBg: "#142E24",
      removedBg: "#2E1418",
      pendingBg: "#1E1440",
    },
  },

  /* ------------------------------------------------------------------ *
   * Halo Ring — alt dark. Void black with an electric ring.
   * Carries the signature motion: the ring closes when the agent sleeps
   * and opens when it wakes. That motion is theme-independent.
   * ------------------------------------------------------------------ */
  "halo-ring": {
    id: "halo-ring",
    label: "Halo Ring",
    mode: "dark",
    blurb: "Void black with an electric ring. Ring opens on wake.",
    bg: "#000000",
    surface: "#0A0F1E",
    surface2: "#101A33",
    border: "#1E2A4A",
    borderAccent: "#2B4CFF",
    text: "#DCE6FF",
    muted: "#8FA3CC",
    dim: "#55648A",
    accent: "#3B82F6",
    accent2: "#7DD3FC",
    success: "#34D399",
    warn: "#FBBF24",
    danger: "#F87171",
    info: "#60A5FA",
    syntax: {
      comment: "#55648A",
      keyword: "#7DD3FC",
      func: "#60A5FA",
      variable: "#DCE6FF",
      string: "#34D399",
      number: "#FBBF24",
      type: "#2B4CFF",
      operator: "#8FA3CC",
      punctuation: "#8FA3CC",
    },
    diff: {
      added: "#34D399",
      removed: "#F87171",
      context: "#55648A",
      addedBg: "#0C2A20",
      removedBg: "#2A1216",
      pendingBg: "#101A33",
    },
  },

  /* ------------------------------------------------------------------ *
   * Forge Red — danger / --yolo only. Never full-time.
   * Reserved for destructive actions, bypassed approvals, and yolo runs.
   * The GUI requires an explicit confirm before selecting it.
   * ------------------------------------------------------------------ */
  "forge-red": {
    id: "forge-red",
    label: "Forge Red",
    mode: "dark",
    blurb: "Danger and --yolo only. Never full-time.",
    isDanger: true,
    bg: "#0A0505",
    surface: "#1A0C0C",
    surface2: "#2A1212",
    border: "#3A1A1A",
    borderAccent: "#DC2626",
    text: "#F5E0DC",
    muted: "#C2A3A0",
    dim: "#7A5F5C",
    accent: "#EF4444",
    accent2: "#F59E0B",
    success: "#34D399",
    warn: "#F59E0B",
    danger: "#DC2626",
    info: "#FCA5A5",
    syntax: {
      comment: "#7A5F5C",
      keyword: "#FCA5A5",
      func: "#F59E0B",
      variable: "#F5E0DC",
      string: "#34D399",
      number: "#F59E0B",
      type: "#DC2626",
      operator: "#C2A3A0",
      punctuation: "#C2A3A0",
    },
    diff: {
      added: "#34D399",
      removed: "#F87171",
      context: "#7A5F5C",
      addedBg: "#12291E",
      removedBg: "#2E1010",
      pendingBg: "#2A1212",
    },
  },
};

export const paletteList: Palette[] = THEME_IDS.map((id) => palettes[id]);

/** The two themes the GUI offers on a cold first run. */
export const defaultDark = "spartan-night" satisfies ThemeId;
export const defaultLight = "hellas-marble" satisfies ThemeId;

/** Ordered for the GUI theme menu: defaults first, then alts, then danger. */
export const menuOrder: ThemeId[] = [
  "spartan-night",
  "hellas-marble",
  "milo-dark",
  "milo-light",
  "ion-purple",
  "halo-ring",
  "forge-red",
];
