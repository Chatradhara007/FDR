import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, getPool } from '../src/db/pool';
import * as clock from '../src/domain/clock';
import { eventsForEntity } from '../src/repositories/eventRepo';
import { NIL_UUID } from '../src/domain/audit';
import { api, bearer, resetDb, userFor } from './helpers';

afterAll(async () => {
  await closePool();
});

beforeEach(async () => {
  await resetDb();
});

describe('phase 01 — app clock', () => {
  it('pure helpers: daysBetween, addDays, istDate', () => {
    expect(clock.daysBetween('2026-12-25', '2027-01-04')).toBe(10);
    expect(clock.daysBetween('2027-03-01', '2027-02-27')).toBe(-2);
    expect(clock.daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(clock.addDays('2026-12-28', 5)).toBe('2027-01-02');
    // 20:00 UTC on 31 Mar is already 1 Apr in India.
    expect(clock.istDate(new Date('2027-03-31T20:00:00Z'))).toBe('2027-04-01');
  });

  it('GET /clock is visible to every role and reports REAL by default', async () => {
    for (const email of ['inst1@demo.in', 'officer@demo.in', 'auditor@demo.in']) {
      const res = await api().get('/api/v1/clock').set(...bearer(await userFor(email)));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ mode: 'REAL', now: expect.any(String), today: await clock.today(getPool()) });
    }
    expect((await api().get('/api/v1/clock')).status).toBe(401);
  });

  it('AC6: advance 10 days moves today() by 10 and writes CLOCK_ADVANCED; reset returns to real time', async () => {
    const admin = await userFor('admin@demo.in');
    const before = await clock.today(getPool());

    const res = await api().post('/api/v1/clock/advance').set(...bearer(admin)).send({ days: 10 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mode: 'SIMULATED', today: clock.addDays(before, 10) });
    expect(res.body.warning).toBeUndefined();
    expect(await clock.today(getPool())).toBe(clock.addDays(before, 10));
    expect(clock.daysBetween(before, await clock.today(getPool()))).toBe(10);

    const events = await eventsForEntity(getPool(), 'clock', NIL_UUID);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'CLOCK_ADVANCED',
      actor_id: admin.id,
      actor_label: admin.name,
      before_json: { mode: 'REAL', today: before },
      after_json: { mode: 'SIMULATED', today: clock.addDays(before, 10), days: 10 },
    });
    // The event itself is stamped with the (new) app clock.
    expect(clock.istDate(events[0].created_at)).toBe(clock.addDays(before, 10));

    const reset = await api().post('/api/v1/clock/reset').set(...bearer(admin));
    expect(reset.status).toBe(200);
    expect(reset.body).toMatchObject({ mode: 'REAL', today: before, warning: 'CLOCK_MOVED_BACKWARDS' });
    expect(await clock.mode(getPool())).toBe('REAL');
    expect((await eventsForEntity(getPool(), 'clock', NIL_UUID)).map((e) => e.action)).toEqual(['CLOCK_ADVANCED', 'CLOCK_RESET']);
  });

  it('AC6: non-admins get 403 on clock changes and nothing changes', async () => {
    for (const email of ['officer@demo.in', 'approver@demo.in', 'inst1@demo.in', 'auditor@demo.in']) {
      const u = await userFor(email);
      expect((await api().post('/api/v1/clock/advance').set(...bearer(u)).send({ days: 10 })).status, email).toBe(403);
      expect((await api().post('/api/v1/clock/set').set(...bearer(u)).send({ date: '2027-01-01' })).status).toBe(403);
      expect((await api().post('/api/v1/clock/reset').set(...bearer(u))).status).toBe(403);
    }
    expect(await clock.mode(getPool())).toBe('REAL');
    expect((await eventsForEntity(getPool(), 'clock', NIL_UUID))).toHaveLength(0);
  });

  it('set: simulates the date at 10:00 IST; moving backwards warns; bad input is 422', async () => {
    const admin = await userFor('admin@demo.in');
    const set = await api().post('/api/v1/clock/set').set(...bearer(admin)).send({ date: '2030-12-12' });
    expect(set.status).toBe(200);
    expect(set.body).toEqual({ mode: 'SIMULATED', now: '2030-12-12T04:30:00.000Z', today: '2030-12-12' });

    const back = await api().post('/api/v1/clock/set').set(...bearer(admin)).send({ date: '2030-01-01' });
    expect(back.body).toMatchObject({ today: '2030-01-01', warning: 'CLOCK_MOVED_BACKWARDS' });

    const adv = await api().post('/api/v1/clock/advance').set(...bearer(admin)).send({ days: 365 });
    expect(adv.body).toMatchObject({ today: '2031-01-01', now: '2031-01-01T04:30:00.000Z' });

    for (const body of [{ days: 0 }, { days: 731 }, { days: 1.5 }, { days: '10' }, {}]) {
      const res = await api().post('/api/v1/clock/advance').set(...bearer(admin)).send(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    for (const date of ['2030-02-30', '12/12/2030', '']) {
      const res = await api().post('/api/v1/clock/set').set(...bearer(admin)).send({ date });
      expect(res.status, date).toBe(422);
      expect(res.body.details[0].field).toBe('date');
    }
  });
});
