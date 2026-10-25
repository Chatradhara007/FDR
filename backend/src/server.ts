import { createApp } from './app';
import { config } from './config';
import { migrate } from './db/migrate';
import { getPool } from './db/pool';

async function waitForDb(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await getPool().query('SELECT 1');
      return;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      console.log('waiting for database...');
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function main(): Promise<void> {
  await waitForDb();
  const applied = await migrate();
  if (applied.length) console.log(`migrations applied: ${applied.join(', ')}`);
  createApp().listen(config.port, () => {
    console.log(`backend listening on :${config.port}`);
  });
}

main().catch((err) => {
  console.error('backend failed to start', err);
  process.exit(1);
});
