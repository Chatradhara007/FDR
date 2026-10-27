// Officer case page, right-hand column: the decision card and the advisory card must never overlap, and every
// action must stay reachable on a short screen. Viewports 1860x930, 1366x768, 1280x720 (sticky column) and 1024x768
// (column stacked under the main content), each scrolled to top, middle and bottom. Also: on an unclaimed case the
// bank action is shown disabled with "Claim this case first".
//
// Needs the stack running on seeded data (`npm run dev` + `npm run seed`). Run: `node e2e/review-layout.mjs [tag]`.
// Screenshots go to e2e/screenshots/review-layout/<tag>/ (gitignored). Exit code 1 on any failed check.

import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const WEB = process.env.E2E_WEB ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:3000/api/v1';
const TAG = process.argv[2] ?? 'after';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'screenshots', 'review-layout', TAG);
const REF = process.env.E2E_REF ?? 'SBIN/FDR/2026/00731';
const VIEWPORTS = [[1860, 930], [1366, 768], [1280, 720], [1024, 768]];

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); console.log(`${ok ? '✓' : '✗'} ${msg}`); };

async function session(email) {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Demo@123' }) });
  if (!res.ok) throw new Error(`login ${email} → ${res.status}`);
  return res.json();
}

async function call(token, method, path, body) {
  const form = body instanceof FormData;
  const res = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(form || !body ? {} : { 'Content-Type': 'application/json' }) },
    body: form ? body : body && JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

/** Demo steps 1–2 for A1: the institution submits it with ₹25 L (the bank holds ₹20 L), the officer claims and verifies. */
async function prepareA1(officer) {
  const inst = await session('inst1@demo.in');
  const today = (await call(inst.token, 'GET', '/clock')).today ?? null;
  const add = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  const d0 = today ?? new Date().toISOString().slice(0, 10);
  const draft = await call(inst.token, 'POST', '/instruments', {
    type: 'FDR', referenceNo: REF, issuingBank: 'State Bank of India', branch: 'Main Branch', amount: '2500000',
    issueDate: add(d0, -10), maturityDate: add(d0, 355), beneficiaryName: 'MEMBER SECRETARY AICTE', lienMarked: true,
    purpose: 'Security deposit for approval of a new institution',
  });
  const files = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'demo-files');
  for (const [docType, name] of [['FDR_COPY', 'A1-fdr-copy.pdf'], ['BANK_LETTER', 'A1-bank-letter.pdf']]) {
    const fd = new FormData();
    fd.append('docType', docType);
    fd.append('file', new Blob([readFileSync(join(files, name))], { type: 'application/pdf' }), name);
    await call(inst.token, 'POST', `/instruments/${draft.id}/documents`, fd);
  }
  await call(inst.token, 'POST', `/instruments/${draft.id}/submit`);
  await call(officer.token, 'POST', `/instruments/${draft.id}/claim`);
  await call(officer.token, 'POST', `/instruments/${draft.id}/verify`);
  return draft.id;
}

async function newPage(browser, viewport, s) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(([t, u]) => { sessionStorage.setItem('fdr.token', t); sessionStorage.setItem('fdr.user', u); }, [s.token, JSON.stringify(s.user)]);
  return context.newPage();
}

/** Geometry of the right-hand column after the page settles at a scroll position. */
const measure = (page) => page.evaluate(() => {
  const aside = document.querySelector('[data-testid="review-side"]') ?? document.querySelector('aside');
  const cards = [...aside.children].filter((c) => c.getBoundingClientRect().height > 0).map((c) => c.getBoundingClientRect());
  const buttons = [...aside.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean);
  const main = document.querySelector('[data-testid="review-main"]') ?? aside.previousElementSibling;
  const r = aside.getBoundingClientRect();
  return {
    cards: cards.map((c) => ({ top: c.top, bottom: c.bottom })),
    aside: { top: r.top, bottom: r.bottom, scrollable: aside.scrollHeight > aside.clientHeight + 1, overflowY: getComputedStyle(aside).overflowY },
    stacked: r.top >= main.getBoundingClientRect().bottom - 1,
    vh: innerHeight, buttons,
  };
});

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const officer = await session('officer@demo.in');
  const auth = { headers: { Authorization: `Bearer ${officer.token}` } };
  const all = (await (await fetch(`${API}/instruments?pageSize=100`, auth)).json()).items;
  const inst = all.find((i) => i.referenceNo === REF) ?? { id: await prepareA1(officer) };
  const browser = await chromium.launch();

  for (const [width, height] of VIEWPORTS) {
    const page = await newPage(browser, { width, height }, officer);
    await page.goto(`${WEB}/officer/review/${inst.id}`);
    await page.getByRole('tab').first().waitFor();
    await page.waitForTimeout(500);
    const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    for (const [pos, y] of [['top', 0], ['middle', Math.round(max / 2)], ['bottom', max]]) {
      await page.evaluate((v) => scrollTo(0, v), y);
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(OUT, `review-${width}x${height}-${pos}.png`) });
      const m = await measure(page);
      const label = `${width}x${height} ${pos}`;
      const overlaps = m.cards.slice(1).filter((c, i) => c.top < m.cards[i].bottom - 0.5);
      check(overlaps.length === 0, `${label}: right-column cards do not overlap`);
      if (width >= 1100) {
        check(!m.stacked, `${label}: column sits beside the main content`);
        check(m.aside.bottom - m.aside.top <= m.vh, `${label}: column fits the viewport (${Math.round(m.aside.bottom - m.aside.top)} ≤ ${m.vh})`);
        check(m.aside.overflowY === 'auto', `${label}: column scrolls internally when taller than the screen`);
      } else {
        check(m.stacked, `${label}: column is stacked under the main content`);
      }
    }
    // Every action in the column can be brought into view (inside the column's own scroll if needed).
    for (const name of ['Return to institution', 'Add observation']) {
      const b = page.getByRole('button', { name, exact: true });
      if (await b.count()) {
        await b.scrollIntoViewIfNeeded();
        check(await b.isVisible() && (await b.boundingBox()).y + 10 < height, `${width}x${height}: "${name}" reachable`);
      }
    }
    await page.context().close();
  }

  // An unclaimed case: the bank action is visible but disabled, with the hint.
  const unclaimed = all.find((i) => i.status === 'SUBMITTED');
  if (unclaimed) {
    const page = await newPage(browser, { width: 1366, height: 768 }, officer);
    await page.goto(`${WEB}/officer/review/${unclaimed.id}`);
    await page.getByRole('tab').first().waitFor();
    const bank = page.getByRole('button', { name: 'Verify with bank' });
    check(await bank.count() === 1 && await bank.isDisabled(), `unclaimed ${unclaimed.referenceNo}: "Verify with bank" shown disabled`);
    check(await page.getByText('Claim this case first').isVisible(), 'unclaimed: hint "Claim this case first" shown');
    await page.screenshot({ path: join(OUT, 'review-unclaimed-1366x768.png') });
    await page.context().close();
  }

  await browser.close();
  console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
