// Mock bank: stands in for an authorised bank verification API (external system, real clock — D19).
// Phase 0 only exposes /health; the verification contract arrives in Phase 3.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const port = Number(process.env.MOCK_BANK_PORT ?? 4000);
app.listen(port, () => {
  console.log(`mock-bank listening on :${port}`);
});
