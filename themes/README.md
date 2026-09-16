# Themes

**Nothing in this directory is hand-edited.** Every file is generated from
`packages/theme-kit/src/palettes.ts`. To change a colour, change it there and
run:

```sh
bun run themes
bun run check
```

`bun run check` fails if anything drifted — the generated bundle, the Worker's
theme metadata, the inline bootstrap script in `index.html`, or the Pi token
count.

## What ships

| directory | for | format |
|---|---|---|
| `pi/` | Pi | one JSON per theme, 53 required tokens + 3 optional |
| `opencode/` | OpenCode | one JSON per theme, plus `milo-greek.json` with dark/light variants |
| `xterm/` | the GUI terminal | `ITheme`, one per theme |
| `bundle.json` | the Worker and the CLI | every theme in one file, written into a sandbox at launch |
| `web.css` | the GUI | CSS custom properties, `:root` + `.dark` + `[data-theme=*]` |
| `themes.json` | tooling | index with labels, modes, and artifact paths |

## The seven

| theme | mode | role |
|---|---|---|
| **Spartan Night** | dark | dark default. Torchlight on charcoal. |
| **Hellas Marble** | light | light default. Marble, law, agora. |
| Milo Dark | dark | original, still shipped |
| Milo Light | light | original, still shipped |
| Ion Purple | dark | alternate |
| Halo Ring | dark | alternate. Ring closes on sleep, opens on wake. |
| Forge Red | dark | **danger and `--yolo` only.** The GUI gates selection behind a confirmation. |

## Installing

```sh
milo themes           # global Pi + project Pi/OpenCode
milo themes --report  # also check COLORTERM
```

Or by hand: copy `pi/<id>.json` into `~/.pi/agent/themes/`, and
`opencode/*.json` into `.opencode/themes/`.

## Command Code

`cmd` has **no custom theme JSON**. It takes exactly three values — `dark`,
`light`, and `auto` (which follows the terminal background via OSC-11). Milo maps
its seven themes onto those three and says so, rather than writing a file `cmd`
will ignore. The mapping is in `bundle.json` under `commandCode`.

## Truecolor

These themes are designed for truecolor. If `COLORTERM` is not `truecolor` or
`24bit`, the terminal will fall back to 16 colours and the themes will look
wrong in a way that looks like a bug in the theme. `milo doctor` checks this.

## The mark is not in here

Logo assets live in `../brand/`. See `../brand/brand.md` for the rules,
including the one that matters most: **the wordmark and the mark are never locked
together.**
