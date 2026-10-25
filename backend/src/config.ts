import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load the repo-root .env for local dev. process.loadEnvFile never overrides variables that are
// already set, so Docker / CI / test values win.
const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

export const config = {
  get port(): number {
    return Number(process.env.PORT ?? 3000);
  },
  get databaseUrl(): string {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set (copy .env.example to .env)');
    return url;
  },
  get mockBankUrl(): string {
    return process.env.MOCK_BANK_URL ?? 'http://localhost:4000';
  },
  get frontendOrigins(): string[] {
    return (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim());
  },
  get demoMode(): boolean {
    return process.env.DEMO_MODE === 'true';
  },
  get jwtSecret(): string {
    return process.env.JWT_SECRET ?? 'dev-secret-change-me';
  },
};
