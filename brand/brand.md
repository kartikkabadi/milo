# Milo brand

Milo is a **sentence-case** word. Not MILO. Not Milo AI. Not Milo™. Not "Milo
Agent". If a sentence starts with it, "Milo" is fine at the head of a sentence;
everywhere else it is "Milo". In a terminal or a CLI invocation it is `milo`.

The voice is a friend who is good with computers and does not need you to know
it. Plain words. Short verbs. Show the command, then show the result. Say what
it did not do, because that is the part people actually need.

Banned, permanently: *revolutionize, unleash, supercharge, magical, seamless,
blazing, effortless, game-changing, AI-powered*.

---

## Assets

| file | what it is | where it goes |
|---|---|---|
| `mark.svg` | the mark, `currentColor`, 32 grid | GUI chrome, docs, anywhere it inherits colour |
| `favicon.svg` | same mark, tight crop, fixed colour | browser tab, 16–32px |
| `app-icon.svg` | mark in a squircle, flat, one colour | app icon, PWA icon, social avatar |
| `app-icon-2.5d.svg` | the only permitted 2.5D | app icon only |
| `wordmark.svg` | "milo" as strokes, `currentColor` | anywhere the name must be drawn, never beside the mark |

---

## The mark

Two shapes. That is the whole thing.

1. **The closed eye.** A shallow arc, statue-cut, gapped at both ends by round
   caps. The watcher asleep. This is the part that carries the Greek identity —
   a carved eyelid line, not a drawn eye.
2. **The branch.** A vertical stem with one **Greek key step** cut into it, a
   diagonal fork, and a **merge dot**. The dot is a zero-length round-capped
   segment, which is why it costs no third shape.

The stem's step is the meander. It is 3.5 units on a 32 grid: legible at 128px,
invisible at 16px, and that is correct. A detail that survives downscaling is a
detail that was too big to begin with.

### Reading it

| size | what you see |
|---|---|
| 16px | a compact glyph with a dot. Enough for a favicon. |
| 32px | arc above branch. A face with one closed eye. |
| 64px+ | the fork, the dot, and the key step are all distinct. |

### Rules

- **Clearspace** is the height of the `o` on every side. At 24px that is 4 units.
- **Minimum size** is 24px digital for the app icon, 16px for the favicon.
- **One colour.** `currentColor` wherever a cascade exists. The favicon and app
  icon set it explicitly because they have nothing to inherit from.
- **2px stroke** on the 32 grid. Scale the whole mark; never scale the stroke
  independently.

### Never

- Outline it. Gradient it. Rotate it. Shadow it. Bevel it.
- Put a photo behind it. No busts, no marble texture, no temple photographs.
- Draw the Parthenon. The Greek identity is in the geometry and the light, not
  in a picture of a building.
- Lock the wordmark and the mark together. They are two assets. Use one.

---

## The wordmark

Lowercase, geometric, built from strokes rather than set in a font. That is a
deliberate choice with three consequences: it cannot reflow, it cannot fall back
to a system serif on a machine that lacks the display face, and it cannot be
rendered at a wrong weight by someone who has never read this file.

Baseline at y=26, x-height top at y=12, ascender at y=6, stroke 3.5, round caps.

**Never lock the wordmark and the mark together.** No horizontal lockup, no
stacked lockup, no "mark + milo" header. Pick one per surface.

---

## Type trio

Three faces, three jobs, no overlap.

| job | face | stack | tracking |
|---|---|---|---|
| marketing headlines | classical serif, modern cut | Newsreader, Literata, Georgia, serif | −0.02em on H1 |
| GUI and chat | Inter Tight | Inter Tight, Inter, system-ui, sans-serif | −0.02em H1, −0.01em body |
| code and terminal | JetBrains Mono | JetBrains Mono, Geist Mono, ui-monospace, monospace | 0 |

Hard rules: **never** mono for paragraphs. **Never** sans for code blocks.
**Never** serif in a terminal.

---

## Colour

Seven themes ship. Two are defaults, four are alternates, one is a warning.

| theme | mode | role |
|---|---|---|
| **Hellas Marble** | light | light default. Marble, law, agora. |
| **Spartan Night** | dark | dark default. Torchlight on charcoal. |
| Milo Dark | dark | original, still shipped |
| Milo Light | light | original, still shipped |
| Ion Purple | dark | alternate |
| Halo Ring | dark | alternate, carries the sleep/wake ring |
| Forge Red | dark | **danger and `--yolo` only. Never full-time.** |

**One accent per theme.** `accent` is actions, cursor, and links. Nothing else.

Dark themes use a **warm off-black**, never pure black. The single exception is
Halo Ring, which is a void by design.

Forge Red is reserved for destructive actions, bypassed approvals, and `--yolo`
runs. The GUI requires an explicit confirmation before selecting it, and the
theme menu labels it. It is not a mood. It is a warning.

### Greek motif usage, inside the app

| motif | where it goes | where it does not |
|---|---|---|
| fluting | vertical rhythm in the sidebar and cards | backgrounds |
| meander key | 2px dividers, progress, the sleep/wake ring track | large decorative fills |
| olive branch | micro empty-state illustration only | anywhere else |
| laurel | success check surround | anything that is not a success |

Abstract geometry only. **No full marble photo backgrounds inside the app.**
Temple and pastoral references belong to the marketing hero, at 8–12% opacity,
and nowhere else.

---

## The Thiel lens

Marble, law, agora. **Innocent, light, real identities. Reading beats writing.**

Torch and bronze. **Energy, but calm and lawful.** Not above-the-law. Not
night-raid. We took the light from the Spartan torch reference. We did not take
the army.

That distinction is the whole brand. A watcher is not a conqueror. Milo's job is
to be awake while you are not, and to leave a clean diff behind. Everything
above — the closed eye, the branch, the warm off-black, the single accent — is in
service of that one idea.
