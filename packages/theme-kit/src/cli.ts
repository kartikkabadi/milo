#!/usr/bin/env node
/**
 * Writes every theme artifact. Run from the repo root:  npm run themes
 *
 * Idempotent. If a file is byte-identical it is left alone, so this is safe
 * to run in a pre-commit hook or a CI drift check.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { emitAll } from "./emit.ts";

const root = resolve(import.meta.dirname, "../../..");

let written = 0;
let unchanged = 0;

for (const [rel, contents] of Object.entries(emitAll())) {
  const abs = resolve(root, rel);
  await mkdir(dirname(abs), { recursive: true });

  let existing: string | null = null;
  try {
    existing = await readFile(abs, "utf8");
  } catch {
    existing = null;
  }

  if (existing === contents) {
    unchanged++;
    continue;
  }

  await writeFile(abs, contents, "utf8");
  written++;
  process.stdout.write(`  wrote  ${rel}\n`);
}

process.stdout.write(`\nthemes: ${written} written, ${unchanged} unchanged\n`);
