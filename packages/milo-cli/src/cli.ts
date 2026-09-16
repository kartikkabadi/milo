#!/usr/bin/env node
/**
 * milo — the CLI.
 *
 * No dependencies on purpose. A global `milo` install should finish in under a second,
 * because the first thing a user does with a tool that is about cost efficiency
 * is notice how long it took to install.
 *
 * Commands:
 *   milo watch [dir]        bind a session to a repo and tail it
 *   milo status [session]   session state, tier, lease, cost
 *   milo sleep [session]    snapshot and release the container now
 *   milo wake [session]     restore from the last snapshot
 *   milo cost               print the cost model
 *   milo themes             install all seven themes for every harness
 *   milo pull               adopt the rules a teammate pushed
 *   milo push               publish your rules
 *   milo doctor             check the environment
 */

import { watch } from "./commands/watch.ts";
import { cost } from "./commands/cost.ts";
import { themes } from "./commands/themes.ts";
import { pull, push } from "./commands/rules.ts";
import { doctor } from "./commands/doctor.ts";
import { status, sleep, wake } from "./commands/session.ts";

const HELP = `milo — the friend that minds your agents

usage: milo <command> [options]

  watch [dir]        bind a session to a repo and follow it
  status [session]   session state, tier, lease, and cost
  sleep [session]    snapshot to git and release the container now
  wake [session]     restore from the last snapshot
  cost               print the cost model, with sources
  themes             install all seven themes for Pi and OpenCode
  pull               adopt the watch rules a teammate pushed
  push               publish your watch rules
  doctor             check the environment

options:
  --help, -h         this
  --version, -v      version
  --api <url>        Milo API base (default: http://127.0.0.1:8787, or $MILO_API)

Milo watches your repo while you sleep. Wakes on CI fail, leaves a diff, goes
back to sleep.
`;

export const VERSION = "0.1.0";

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    process.stdout.write(`milo ${VERSION}\n`);
    return 0;
  }

  switch (command) {
    case "watch":
      return watch(rest);
    case "status":
      return status(rest);
    case "sleep":
      return sleep(rest);
    case "wake":
      return wake(rest);
    case "cost":
      return cost(rest);
    case "themes":
      return themes(rest);
    case "pull":
      return pull(rest);
    case "push":
      return push(rest);
    case "doctor":
      return doctor(rest);
    default:
      process.stderr.write(`milo: unknown command '${command}'\n\n${HELP}`);
      return 2;
  }
}

// Exit codes: 0 ok, 1 the thing you asked about failed, 2 you asked wrong.
const code = await main(process.argv.slice(2));
process.exit(code);
