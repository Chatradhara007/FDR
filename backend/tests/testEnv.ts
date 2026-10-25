import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Point the app at the test database before any app module reads DATABASE_URL.
// Refuse to run without TEST_DATABASE_URL so a dev database is never dropped by accident.
const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error('TEST_DATABASE_URL is not set; refusing to run tests against DATABASE_URL');
process.env.DATABASE_URL = testUrl;
process.env.MOCK_BANK_URL = process.env.TEST_MOCK_BANK_URL ?? 'http://127.0.0.1:9'; // unreachable unless a test starts one
process.env.JWT_SECRET = 'test-secret';
