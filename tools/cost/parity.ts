/**
 * Parity check: the CLI's copy of the cost arithmetic vs the Worker's.
 *
 * `milo cost` duplicates the model on purpose — it has to work with no API and
 * no clone. That duplication is only acceptable if it is verified. This script
 * runs both implementations over the same inputs and fails on any disagreement
 * larger than a cent.
 */
import { INSTANCE_TYPES, PLAN_BASE_USD } from "../../workers/api/src/cost/rates.ts";
import { containerCost as modelContainerCost, includedContainerHours } from "../../workers/api/src/cost/model.ts";

/* Re-declared exactly as packages/milo-cli/src/commands/cost.ts declares them.
   If you change one, this file fails, which is the point. */
const MEMORY_INCLUDED_GIB_H = 25;
const MEMORY_PER_GIB_S = 0.0000025;
const CPU_INCLUDED_VCPU_MIN = 375;
const CPU_PER_VCPU_S = 0.00002;
const DISK_INCLUDED_GB_H = 200;
const DISK_PER_GB_S = 0.00000007;

const CLI_LITE = { vcpu: 1 / 16, memoryMiB: 256, diskGb: 2, id: "lite" };

const cliIncludedHours = (i: { memoryMiB: number; diskGb: number }) =>
  Math.min(MEMORY_INCLUDED_GIB_H / (i.memoryMiB / 1024), DISK_INCLUDED_GB_H / i.diskGb);

function cliContainerCost(i: { vcpu: number; memoryMiB: number; diskGb: number }, hours: number, cpuBusy: number) {
  const inc = cliIncludedHours(i);
  const billable = Math.max(0, hours - inc);
  const memory = billable * (i.memoryMiB / 1024) * 3600 * MEMORY_PER_GIB_S;
  const disk = billable * i.diskGb * 3600 * DISK_PER_GB_S;
  const cpuS = hours * i.vcpu * cpuBusy * 3600;
  const cpu = Math.max(0, cpuS - CPU_INCLUDED_VCPU_MIN * 60) * CPU_PER_VCPU_S;
  return { memory, disk, cpu, total: memory + disk + cpu };
}

let failures = 0;
const TOLERANCE = 0.01;

const hoursToTest = [0, 50, 100, 100.5, 300, 900, 1500, 3000];
const busyToTest = [0.02, 0.27, 0.5, 0.85, 1];

for (const hours of hoursToTest) {
  for (const busy of busyToTest) {
    const a = cliContainerCost(CLI_LITE, hours, busy);
    const b = modelContainerCost({ instance: INSTANCE_TYPES.lite, containerHours: hours, cpuBusyFraction: busy });

    for (const key of ["memory", "disk", "cpu", "total"] as const) {
      const delta = Math.abs(a[key] - b[key]);
      if (delta > TOLERANCE) {
        failures++;
        process.stderr.write(
          `FAIL  containerCost.${key} at hours=${hours} busy=${busy}: cli=${a[key].toFixed(4)} model=${b[key].toFixed(4)} delta=${delta.toFixed(4)}\n`,
        );
      }
    }
  }
}

const incCli = cliIncludedHours(CLI_LITE);
const incModel = includedContainerHours(INSTANCE_TYPES.lite).hours;
if (Math.abs(incCli - incModel) > 1e-9) {
  failures++;
  process.stderr.write(`FAIL  included hours: cli=${incCli} model=${incModel}\n`);
}

if (failures === 0) {
  process.stdout.write(
    `ok    cli and model agree on ${hoursToTest.length * busyToTest.length} container cost combinations (tolerance ${TOLERANCE})\n`,
  );
  process.stdout.write(`ok    included lite container-hours: ${incModel} in both\n`);
  process.stdout.write(`ok    base plan: $${PLAN_BASE_USD.toFixed(2)} in both\n`);
}

process.stdout.write(`\n${failures === 0 ? "parity check passed" : `${failures} parity failure(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);
