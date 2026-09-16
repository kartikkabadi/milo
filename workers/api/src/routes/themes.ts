/**
 * Theme metadata for the API and the GUI theme menu.
 *
 * This is a hand-maintained mirror of `packages/theme-kit/src/palettes.ts`.
 * It is duplicated rather than imported because the Worker bundle must not
 * pull the theme generator in — the generator writes files and has no business
 * in a request path. The drift check in tools/themes/check.ts fails the build
 * if the two disagree.
 */

export interface ThemeMeta {
  id: string;
  label: string;
  mode: "dark" | "light";
  blurb: string;
  defaultFor: "dark" | "light" | null;
  danger: boolean;
  /** Swatch colours for the theme menu dots. */
  swatch: { bg: string; accent: string; text: string };
}

export const THEMES: ThemeMeta[] = [
  {
    id: "spartan-night",
    label: "Spartan Night",
    mode: "dark",
    blurb: "Torchlight on charcoal. The default torch-dark theme.",
    defaultFor: "dark",
    danger: false,
    swatch: { bg: "#0C0A08", accent: "#E86A1F", text: "#EDE6D6" },
  },
  {
    id: "hellas-marble",
    label: "Hellas Marble",
    mode: "light",
    blurb: "Aegean blue on marble. The default daylight theme.",
    defaultFor: "light",
    danger: false,
    swatch: { bg: "#F5F1E8", accent: "#3A7BD5", text: "#1E1C18" },
  },
  {
    id: "milo-dark",
    label: "Milo Dark",
    mode: "dark",
    blurb: "The original. Cool blue on ink.",
    defaultFor: null,
    danger: false,
    swatch: { bg: "#1a1b26", accent: "#7aa2f7", text: "#cdd6f4" },
  },
  {
    id: "milo-light",
    label: "Milo Light",
    mode: "light",
    blurb: "The original daylight. Plain paper.",
    defaultFor: null,
    danger: false,
    swatch: { bg: "#ffffff", accent: "#0969da", text: "#1f2328" },
  },
  {
    id: "ion-purple",
    label: "Ion Purple",
    mode: "dark",
    blurb: "Black-violet at the top, ionising downward.",
    defaultFor: null,
    danger: false,
    swatch: { bg: "#0A0618", accent: "#8B5CF6", text: "#EDE9FE" },
  },
  {
    id: "halo-ring",
    label: "Halo Ring",
    mode: "dark",
    blurb: "Void black with an electric ring. Ring opens on wake.",
    defaultFor: null,
    danger: false,
    swatch: { bg: "#000000", accent: "#3B82F6", text: "#DCE6FF" },
  },
  {
    id: "forge-red",
    label: "Forge Red",
    mode: "dark",
    blurb: "Danger only. Never full-time.",
    defaultFor: null,
    danger: true,
    swatch: { bg: "#0A0505", accent: "#EF4444", text: "#F5E0DC" },
  },
];
