// SHOWCASE_MODE=true check: signs in as each role through the login page's "Sign in as" role picker, opens the role's
// landing page and screenshots it at 1920x1080, 1366x768 and 390x844. On every page: no demo ribbon or demo wording,
// no raw "undefined"/"null"/"NaN", no horizontal scroll, no overlapping header items, no empty section, every button
// named. Also: the demo endpoints answer 403 and /admin/demo does not exist.
//
// Needs the stack running with SHOWCASE_MODE=true on seeded data (see docs/DEPLOY.md, or `npm run dev` with
// SHOWCASE_MODE=true in .env). Run: `node e2e/showcase.mjs` (E2E_WEB, E2E_API to override).
// Screenshots go to e2e/screenshots/showcase/ (gitignored). Exit code 1 on any failed check.

import { mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const WEB = process.env.E2E_WEB ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:3000/api/v1';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'screenshots', 'showcase');
const VIEWPORTS = [[1920, 1080], [1366, 768], [390, 844]];
const ROLES = [
  { label: 'Institution', home: '/institution' },
  { label: 'Scrutiny officer', home: '/officer' },
  { label: 'Approver', home: '/approver' },
  { label: 'Admin', home: '/admin' },
  { label: 'Auditor', home: '/auditor' },
];
// Demo chrome and scenario wording that must not appear anywhere in showcase mode.
const FORBIDDEN = [/\bDemo mode\b/i, /synthetic/i, /\bsimulated\b/i, /Demo tools/i, /Demo accounts/i, /\bA[1-9]\b/, /\bundefined\b/, /\bnull\b/, /\bNaN\b/];

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); console.log(`${ok ? '✓' : '✗'} ${msg}`); };

/** Everything a page must satisfy, measured in the browser. */
const inspect = (page) => page.evaluate(() => {
  const text = document.body.innerText;
  const header = document.querySelector('header > div');
  const items = header ? [...header.children].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0) : [];
  const overlaps = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps.push([i, j]);
  }
  const unnamed = [...document.querySelectorAll('button, a[href]')]
    .filter((b) => b.getClientRects().length && !(b.getAttribute('aria-label') || b.textContent.trim() || b.getAttribute('title')))
    .map((b) => b.outerHTML.slice(0, 80));
  const emptySections = [...document.querySelectorAll('main section')]
    .filter((s) => s.getClientRects().length && !s.innerText.trim()).length;
  return {
    text,
    ribbon: !!document.querySelector('[data-testid="demo-ribbon"]'),
    hscroll: document.documentElement.scrollWidth > innerWidth + 1,
    overlaps: overlaps.length, unnamed, emptySections,
  };
});

async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
}

function checkPage(m, label) {
  check(!m.ribbon, `${label}: no element with data-testid="demo-ribbon"`);
  for (const re of FORBIDDEN) check(!re.test(m.text), `${label}: no text matching ${re}`);
  check(!m.hscroll, `${label}: no horizontal scroll`);
  check(m.overlaps === 0, `${label}: header items do not overlap`);
  check(m.unnamed.length === 0, `${label}: every button and link has a name${m.unnamed.length ? ` (${m.unnamed.join(' | ')})` : ''}`);
  check(m.emptySections === 0, `${label}: no empty panels`);
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const health = await (await fetch(`${API}/health`)).json();
  check(health.showcaseMode === true, 'server runs with SHOWCASE_MODE=true');
  for (const [m, p] of [['POST', '/demo/reset'], ['GET', '/demo/users'], ['GET', '/demo/anchors']]) {
    check((await fetch(`${API}${p}`, { method: m })).status === 403, `${m} ${p} → 403`);
  }

  const browser = await chromium.launch();
  const errors = [];
  for (const role of ROLES) {
    const context = await browser.newContext({ viewport: { width: VIEWPORTS[0][0], height: VIEWPORTS[0][1] } });
    const page = await context.newPage();
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`${role.label}: ${msg.text()}`); });
    await page.goto(`${WEB}/login`);
    await page.getByTestId('role-picker').waitFor();
    if (role === ROLES[0]) {
      await settle(page);
      checkPage(await inspect(page), 'login 1920x1080');
      await page.screenshot({ path: join(OUT, 'login-1920x1080.png'), fullPage: true });
    }
    await page.getByRole('button', { name: `Sign in as ${role.label}: fill in the sample account` }).click();
    check(await page.locator('#password').inputValue() !== '', `${role.label}: the role picker fills the password`);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(`${WEB}${role.home}`);
    for (const [width, height] of VIEWPORTS) {
      await page.setViewportSize({ width, height });
      await settle(page);
      const tag = `${role.label} ${width}x${height}`;
      checkPage(await inspect(page), tag);
      await page.screenshot({ path: join(OUT, `${role.home.slice(1)}-${width}x${height}.png`), fullPage: true });
    }
    if (role.home === '/admin') {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`${WEB}/admin/clock`);
      await page.getByTestId('app-clock-date').waitFor();
      check(await page.getByRole('button', { name: '+90d' }).count() === 1, 'Admin > App clock has the clock controls');
      await settle(page);
      checkPage(await inspect(page), 'Admin > App clock 1366x768');
      // The "move the date" dialog too (opened and cancelled: the app date is not changed).
      await page.getByRole('button', { name: 'Move the app date…' }).click();
      await page.getByLabel('App date', { exact: true }).waitFor();
      checkPage(await inspect(page), 'Admin > App clock, move dialog');
      await page.getByRole('button', { name: 'Cancel' }).click();
      await page.screenshot({ path: join(OUT, 'admin-clock-1366x768.png'), fullPage: true });
      await page.goto(`${WEB}/admin/demo`);
      const notFound = await page.getByText('Page not found').waitFor({ timeout: 5000 }).then(() => true, () => false);
      check(notFound, '/admin/demo does not exist');
    }
    await context.close();
  }
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto(`${WEB}/help/about`);
  await settle(page);
  checkPage(await inspect(page), 'about 1366x768');
  await page.screenshot({ path: join(OUT, 'about-1366x768.png'), fullPage: true });
  await browser.close();

  if (errors.length) console.log(`console errors:\n  ${errors.join('\n  ')}`);
  console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall showcase checks passed');
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
