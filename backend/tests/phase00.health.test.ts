import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { closePool } from '../src/db/pool';
import { asyncHandler } from '../src/middleware/asyncHandler';
import { validate } from '../src/middleware/validate';
import { api, resetDb } from './helpers';

afterAll(async () => {
  await closePool();
});

beforeEach(async () => {
  await resetDb();
});

const testApp = () =>
  api({
    mountTestRoutes: (router) => {
      router.get('/__test/boom', () => {
        throw new Error('kaboom');
      });
      router.get(
        '/__test/async-boom',
        asyncHandler(async () => {
          throw new Error('async kaboom');
        }),
      );
      router.post(
        '/__test/validate',
        validate({
          body: z.object({
            name: z.string().min(1),
            amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
            maturityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          }),
        }),
        (req, res) => {
          res.json({ ok: true, body: req.body });
        },
      );
    },
  });

describe('phase 00 — health and error shape', () => {
  it('AC3: GET /api/v1/health returns 200 with db up', async () => {
    const res = await api().get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up' });
    expect(['up', 'down']).toContain(res.body.mockBank);
    expect(typeof res.body.time).toBe('string');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('health reports the mock bank up when it answers', async () => {
    const bank = http.createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end('{"status":"ok"}');
    });
    await new Promise<void>((r) => bank.listen(0, '127.0.0.1', r));
    const prev = process.env.MOCK_BANK_URL;
    process.env.MOCK_BANK_URL = `http://127.0.0.1:${(bank.address() as AddressInfo).port}`;
    try {
      const res = await api().get('/api/v1/health');
      expect(res.body.mockBank).toBe('up');
    } finally {
      process.env.MOCK_BANK_URL = prev;
      await new Promise((r) => bank.close(r));
    }
    const down = await api().get('/api/v1/health');
    expect(down.body.mockBank).toBe('down');
  });

  it('AC4: unknown routes return 404 shaped { code, message, details }', async () => {
    for (const path of ['/api/v1/does-not-exist', '/nope']) {
      const res = await api().get(path);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ code: 'NOT_FOUND', message: expect.any(String), details: null });
    }
  });

  it('AC5: a plain Error becomes 500 INTERNAL with the request id', async () => {
    for (const path of ['/api/v1/__test/boom', '/api/v1/__test/async-boom']) {
      const res = await testApp().get(path).set('X-Request-Id', 'req-abc-123');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        code: 'INTERNAL',
        message: 'Unexpected error',
        details: { requestId: 'req-abc-123' },
      });
      expect(res.headers['x-request-id']).toBe('req-abc-123');
      expect(JSON.stringify(res.body)).not.toContain('kaboom');
    }
  });

  it('AC5: a generated request id is returned when none is sent', async () => {
    const res = await testApp().get('/api/v1/__test/boom');
    expect(res.body.details.requestId).toBe(res.headers['x-request-id']);
    expect(res.body.details.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('AC6: validate() returns 422 listing every failing field', async () => {
    const res = await testApp()
      .post('/api/v1/__test/validate')
      .send({ name: '', amount: '12.345', maturityDate: '31/03/2027' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    const fields = (res.body.details as { field: string; message: string }[]).map((d) => d.field).sort();
    expect(fields).toEqual(['amount', 'maturityDate', 'name']);
    for (const d of res.body.details) expect(d.message).toEqual(expect.any(String));
  });

  it('validate() lists missing fields and passes valid bodies', async () => {
    const missing = await testApp().post('/api/v1/__test/validate').send({});
    expect(missing.status).toBe(422);
    expect(missing.body.details).toHaveLength(3);

    const ok = await testApp()
      .post('/api/v1/__test/validate')
      .send({ name: 'A', amount: '2500000.00', maturityDate: '2027-03-31' });
    expect(ok.status).toBe(200);
  });

  it('malformed JSON is a 422 in the standard shape', async () => {
    const res = await testApp()
      .post('/api/v1/__test/validate')
      .set('content-type', 'application/json')
      .send('{"name":');
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED', details: [{ field: 'body' }] });
  });
});
