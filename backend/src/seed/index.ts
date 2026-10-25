import { migrate } from '../db/migrate';
import { closePool, getPool } from '../db/pool';
import { DEMO_PASSWORD, seedBase } from './base';

// `npm run seed`: migrations + base dataset. Phase 9 adds the demo instruments (docs/seed-spec.md).
async function main(): Promise<void> {
  const applied = await migrate();
  if (applied.length) console.log(`migrations applied: ${applied.join(', ')}`);
  await seedBase(getPool());
  console.log(`seed: base institutions, users (password ${DEMO_PASSWORD}) and rules loaded`);
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
