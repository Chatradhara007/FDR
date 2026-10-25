import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, exec, getPool } from '../src/db/pool';
import { api, bearer, resetDb, userFor } from './helpers';

afterAll(async () => {
  await closePool();
});

beforeEach(async () => {
  await resetDb();
});

describe('phase 01 — authentication', () => {
  it('AC1: login succeeds with the right password and returns token + user', async () => {
    const res = await api().post('/api/v1/auth/login').send({ email: 'Officer@Demo.in ', password: 'Demo@123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toEqual({
      id: expect.any(String),
      name: 'Anjali Deshmukh',
      email: 'officer@demo.in',
      role: 'officer',
      institutionId: null,
      institutionName: null,
      designation: expect.any(String),
    });

    const me = await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body).toEqual(res.body.user);
  });

  it('AC1: institution user carries institution id and name', async () => {
    const res = await api().post('/api/v1/auth/login').send({ email: 'inst1@demo.in', password: 'Demo@123' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role: 'institution', institutionName: 'Vasavi College of Engineering, Hyderabad' });
    expect(res.body.user.institutionId).toEqual(expect.any(String));
  });

  it('AC1: wrong password and unknown email both give the same 401', async () => {
    const wrong = await api().post('/api/v1/auth/login').send({ email: 'officer@demo.in', password: 'nope' });
    const unknown = await api().post('/api/v1/auth/login').send({ email: 'ghost@demo.in', password: 'Demo@123' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual({ code: 'INVALID_CREDENTIALS', message: expect.any(String), details: null });
    expect(unknown.body).toEqual(wrong.body);
  });

  it('login validates input as 422 listing every field', async () => {
    const res = await api().post('/api/v1/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(422);
    expect(res.body.details.map((d: { field: string }) => d.field).sort()).toEqual(['email', 'password']);
  });

  it('a deactivated user cannot log in and their existing token stops working', async () => {
    const officer = await userFor('officer@demo.in');
    await exec(getPool(), "UPDATE users SET active = false WHERE email = 'officer@demo.in'");
    const login = await api().post('/api/v1/auth/login').send({ email: 'officer@demo.in', password: 'Demo@123' });
    expect(login.status).toBe(401);
    const me = await api().get('/api/v1/auth/me').set(...bearer(officer));
    expect(me.status).toBe(401);
  });

  it('AC2: the 6th attempt within a minute for the same email+IP is 429', async () => {
    const agent = api();
    for (let i = 0; i < 5; i++) {
      const res = await agent.post('/api/v1/auth/login').send({ email: 'approver@demo.in', password: `bad${i}` });
      expect(res.status).toBe(401);
    }
    const sixth = await agent.post('/api/v1/auth/login').send({ email: 'approver@demo.in', password: 'Demo@123' });
    expect(sixth.status).toBe(429);
    expect(sixth.body).toEqual({ code: 'RATE_LIMITED', message: expect.any(String), details: null });

    // Another email from the same IP is not affected.
    const other = await agent.post('/api/v1/auth/login').send({ email: 'admin@demo.in', password: 'Demo@123' });
    expect(other.status).toBe(200);
  });

  it('GET /demo/users lists demo users when DEMO_MODE=true and 404s otherwise', async () => {
    const prev = process.env.DEMO_MODE;
    try {
      process.env.DEMO_MODE = 'true';
      const res = await api().get('/api/v1/demo/users');
      expect(res.status).toBe(200);
      expect(res.body.map((u: { email: string }) => u.email)).toContain('inst1@demo.in');
      expect(res.body[0]).toEqual({
        email: 'inst1@demo.in',
        name: expect.any(String),
        role: 'institution',
        institutionName: 'Vasavi College of Engineering, Hyderabad',
      });
      expect(JSON.stringify(res.body)).not.toContain('password');

      process.env.DEMO_MODE = 'false';
      expect((await api().get('/api/v1/demo/users')).status).toBe(404);
    } finally {
      process.env.DEMO_MODE = prev;
    }
  });
});
