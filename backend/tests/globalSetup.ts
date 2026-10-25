import './testEnv';
import { migrate, resetSchema } from '../src/db/migrate';
import { closePool } from '../src/db/pool';

export async function setup(): Promise<void> {
  await resetSchema();
  await migrate();
  await closePool();
}
