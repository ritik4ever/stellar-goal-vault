/**
 * CLI entry for the deterministic development seed.
 *
 * Usage (from backend/):
 *   npm run seed
 *   npm run seed -- --count 10
 *
 * Wipes campaign-owned local rows and inserts fixed open / funded / claimed
 * fixtures. Never uses live funds or network accounts.
 */
import { parseCountArg, seedDeterministicState } from '../services/seedDeterministic';

function main(): void {
  const count = parseCountArg(process.argv.slice(2));
  const ids = seedDeterministicState(count);
  // Observable success signal for the seed runbook / operators.
  console.log(`Seeded ${ids.length} campaign(s): ${ids.join(', ')}`);
}

main();
