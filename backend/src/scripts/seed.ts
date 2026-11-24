/**
 * CLI entry for the deterministic development seed.
 *
 * Usage (from backend/):
 *   npm run seed
 *   npm run seed -- --count 10
 *   npm run seed -- --force
 *
 * Wipes campaign-owned local rows and inserts fixed open / funded / claimed
 * fixtures. Never uses live funds or network accounts.
 *
 * Reruns are safe: if the database already contains the deterministic seed,
 * the command reports that and exits successfully without touching data.
 * Pass --force to bypass the idempotency guard and wipe-and-reinsert.
 */
import { parseCountArg, seedDeterministicState } from '../services/seedDeterministic';

function hasForceFlag(argv: string[]): boolean {
  return argv.includes('--force');
}

function main(): void {
  const argv = process.argv.slice(2);
  const count = parseCountArg(argv);
  const force = hasForceFlag(argv);

  const result = seedDeterministicState(count, { force });

  if (result.status === 'already-seeded') {
    console.log(
      `Database already seeded with ${result.ids.length} deterministic campaign(s); nothing to do. ` +
        `To force a reset, delete the local DB file (or run with --force) and re-run npm run seed.`,
    );
    return;
  }

  // Observable success signal for the seed runbook / operators.
  console.log(`Seeded ${result.ids.length} campaign(s): ${result.ids.join(', ')}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Seed failed: ${message}`);
  process.exitCode = 1;
}