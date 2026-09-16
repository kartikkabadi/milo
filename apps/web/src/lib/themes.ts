/**
 * Theme runtime for the GUI.
 *
 * The seven themes come from `themes/bundle.json`, which is generated from the
 * same palette source that emits the Pi, OpenCode, and xterm themes. So the GUI
 * theme menu and the terminal theme can never disagree about what "Spartan
 * Night" is.
 *
 * FOUC: the theme is applied by an inline script in index.html before first
 * paint. This module only reads and changes it afterwards.
 */

import bundle from "../../../../themes/bundle.json";

export type ThemeMode = "dark" | "light";

export interface ThemeMeta {
  id: string;
  label: string;
  mode: ThemeMode;
  blurb: string;
  /** The two defaults offered on a cold first run. */
  defaultFor: ThemeMode | null;
  /** Forge Red. Selection requires an explicit confirmation. */
  danger: boolean;
  swatch: { bg: string; accent: string; text: string };
}

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

const PALETTES = bundle.pi as Record<
  string,
  { name: string; vars: Record<string, string>; colors: Record<string, string> }
>;

const XTERM = bundle.xterm as Record<string, XtermTheme>;

/**
 * Menu order: the two defaults first, then the originals, then the alternates,
 * then the danger theme last and labelled. Order is information.
 */
const ORDER = [
  "spartan-night",
  "hellas-marble",
  "milo-dark",
  "milo-light",
  "ion-purple",
  "halo-ring",
  "forge-red",
] as const;

const META: Record<string, { label: string; mode: ThemeMode; blurb: string; defaultFor: ThemeMode | null; danger: boolean }> = {
  "spartan-night": {
    label: "Spartan Night",
    mode: "dark",
    blurb: "Torchlight on charcoal. The default torch-dark theme.",
    defaultFor: "dark",
    danger: false,
  },
  "hellas-marble": {
    label: "Hellas Marble",
    mode: "light",
    blurb: "Aegean blue on marble. The default daylight theme.",
    defaultFor: "light",
    danger: false,
  },
  "milo-dark": { label: "Milo Dark", mode: "dark", blurb: "The original. Cool blue on ink.", defaultFor: null, danger: false },
  "milo-light": { label: "Milo Light", mode: "light", blurb: "The original daylight. Plain paper.", defaultFor: null, danger: false },
  "ion-purple": { label: "Ion Purple", mode: "dark", blurb: "Black-violet at the top, ionising downward.", defaultFor: null, danger: false },
  "halo-ring": { label: "Halo Ring", mode: "dark", blurb: "Void black with an electric ring. Ring opens on wake.", defaultFor: null, danger: false },
  "forge-red": { label: "Forge Red", mode: "dark", blurb: "Danger and --yolo only. Never full-time.", defaultFor: null, danger: true },
};

export const themes: ThemeMeta[] = ORDER.map((id) => {
  const meta = META[id];
  const colors = PALETTES[id].colors;
  return {
    id,
    label: meta.label,
    mode: meta.mode,
    blurb: meta.blurb,
    defaultFor: meta.defaultFor,
    danger: meta.danger,
    swatch: { bg: colors.bg || "#000", accent: colors.accent, text: colors.text },
  };
});

export const THEME_IDS = ORDER;

export const defaultDark = "spartan-night";
export const defaultLight = "hellas-marble";

export function isThemeId(id: string): boolean {
  return (ORDER as readonly string[]).includes(id);
}

export function themeById(id: string): ThemeMeta {
  return themes.find((t) => t.id === id) ?? themes[0];
}

export function xtermTheme(id: string): XtermTheme {
  return XTERM[id] ?? XTERM[defaultDark];
}

/**
 * Apply a theme.
 *
 * Two mechanisms, both needed:
 *   - `data-theme` on <html> drives the generated CSS variable blocks.
 *   - `.dark` on <html> drives Tailwind's `dark:` variant.
 *
 * `color-scheme` is set by the CSS blocks themselves, so native form controls
 * and scrollbars follow without a second code path.
 */
export function applyTheme(id: string, root: HTMLElement = document.documentElement): void {
  const theme = themeById(id);
  root.setAttribute("data-theme", theme.id);
  root.classList.toggle("dark", theme.mode === "dark");
  root.style.colorScheme = theme.mode;
}

const STORAGE_KEY = "milo.theme";

/** Read the persisted theme, or fall back to the system preference. */
export function resolveInitialTheme(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isThemeId(stored)) return stored;
  } catch {
    // Private mode, or storage disabled. Fall through to the system preference.
  }
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
  return prefersDark ? defaultDark : defaultLight;
}

export function persistTheme(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Not being able to remember the theme is not a reason to fail a click.
  }
}

/**
 * The inline script that runs before first paint, as a string.
 *
 * Kept here rather than in index.html so it and `resolveInitialTheme` cannot
 * drift. index.html is generated from this at build time by the plugin in
 * vite.config.ts — see the README if you change one and not the other.
 */
export const THEME_BOOTSTRAP = `(function(){try{var k="milo.theme";var s=localStorage.getItem(k);var m={${ORDER.map(
  (id) => `"${id}":${META[id].mode === "dark" ? 1 : 0}`,
).join(",")}};var id=s&&m[s]!==undefined?s:null;if(!id){id=window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"${defaultLight}":"${defaultDark}"}var r=document.documentElement;r.setAttribute("data-theme",id);r.classList.toggle("dark",m[id]===1);r.style.colorScheme=m[id]===1?"dark":"light"}catch(e){document.documentElement.setAttribute("data-theme","${defaultDark}");document.documentElement.classList.add("dark")}})();`;
