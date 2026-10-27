// UI direction check: screenshots of the shell and the migrated pages at several widths, plus layout assertions.
//
// Needs the stack running in demo mode on seeded data (`npm run dev` + `npm run seed`) and Playwright with Chromium.
// Run: `node e2e/ui-shots.mjs`. Screenshots go to e2e/screenshots/ui/ (gitignored). Exit code 1 on any failed check.
//
// Checks: no horizontal page overflow at any width; the admin menu bar stays on one line at 1280 and 1366 px;
// the menu dropdowns work from the keyboard; the post-Phase-09 pages (QR verify, advisory flags, passport,
// printable passport, release order) render inside the new shell; no console errors.

import { mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const WEB = process.env.E2E_WEB ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:3000/api/v1';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'screenshots', 'ui');
const WIDTHS = [1920, 1366, 1280, 768, 390];
const PASSWORD = 'Demo@123';

const failures = [];
const consoleErrors = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); console.log(`${ok ? '✓' : '✗'} ${msg}`); };

async function api(path, token) {
  const res = await fetch(`${API}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}
const sessions = new Map();
async function session(email) {
  if (sessions.has(email)) return sessions.get(email);
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (!res.ok) throw new Error(`login ${email} → ${res.status}`);
  const s = await res.json();
  sessions.set(email, s);
  return s;
}
const login = async (email) => (await session(email)).token;

async function newPage(browser, width, email) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  if (email) {
    // Same storage the app uses (auth/token.ts): token and user in sessionStorage.
    const { token, user } = await session(email);
    await context.addInitScript(([t, u]) => { sessionStorage.setItem('fdr.token', t); sessionStorage.setItem('fdr.user', u); }, [token, JSON.stringify(user)]);
  }
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${email ?? 'public'} ${width} ${page.url()}: ${m.text()}`); });
  page.on('pageerror', (e) => consoleErrors.push(`${email ?? 'public'} ${width} ${page.url()}: pageerror ${e.message}`));
  return page;
}

async function noOverflow(page, label) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  check(sw <= cw, `${label}: no horizontal page overflow (${sw} ≤ ${cw})`);
}

async function visit(page, path, name, width, waitFor) {
  await page.goto(`${WEB}${path}`);
  if (waitFor) await waitFor(page);
  else await page.waitForLoadState('networkidle');
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(OUT, `${name}-${width}.png`), fullPage: true });
  await noOverflow(page, `${name} @${width}`);
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const adminToken = await login('admin@demo.in');
  const released = (await api('/release-requests?status=APPROVED', adminToken)).items[0];
  const order = released ? await api(`/release-requests/${released.id}`, adminToken) : null;
  const instruments = (await api('/instruments?pageSize=100', adminToken)).items;
  const anyInstrument = instruments.find((i) => i.status === 'ACTIVE') ?? instruments[0];
  const pending = instruments.filter((i) => i.status === 'SUBMITTED' || i.status === 'UNDER_SCRUTINY');

  const signedInPages = [
    { email: 'admin@demo.in', path: '/dashboard', name: 'admin-dashboard', wait: (p) => p.getByTestId('as-of').waitFor() },
    { email: 'approver@demo.in', path: '/dashboard', name: 'approver-dashboard', wait: (p) => p.getByTestId('as-of').waitFor() },
    { email: 'auditor@demo.in', path: '/dashboard', name: 'auditor-dashboard', wait: (p) => p.getByTestId('as-of').waitFor() },
    { email: 'officer@demo.in', path: '/officer', name: 'officer-myday', wait: (p) => p.getByText(/Why this order/).first().waitFor() },
  ];

  for (const width of WIDTHS) {
    const pub = await newPage(browser, width);
    await visit(pub, '/login', 'login', width, (p) => p.getByRole('heading', { name: 'Demo accounts (synthetic data)' }).waitFor());
    await visit(pub, '/policies/accessibility', 'accessibility', width);
    await pub.context().close();
    for (const s of signedInPages) {
      const page = await newPage(browser, width, s.email);
      await visit(page, s.path, s.name, width, s.wait);
      await page.context().close();
    }
  }

  // Admin menu bar on one line at 1280 and 1366 px; keyboard use of a dropdown.
  for (const width of [1280, 1366]) {
    const page = await newPage(browser, width, 'admin@demo.in');
    await page.goto(`${WEB}/dashboard`);
    await page.getByTestId('as-of').waitFor();
    const m = await page.evaluate(() => {
      const ul = document.querySelector('[data-testid="menu-list"]');
      const items = [...ul.children].map((li) => li.getBoundingClientRect());
      return { tops: new Set(items.map((r) => Math.round(r.top))).size, sw: ul.scrollWidth, cw: ul.clientWidth, right: Math.max(...items.map((r) => r.right)), vw: window.innerWidth };
    });
    check(m.tops === 1 && m.sw <= m.cw && m.right <= m.vw, `admin menu bar @${width}: one line, no overflow (rows ${m.tops}, ${m.sw}/${m.cw}, right ${Math.round(m.right)} ≤ ${m.vw})`);
    if (width === 1366) {
      const btn = page.getByRole('button', { name: 'Monitoring' });
      await btn.focus();
      await page.keyboard.press('ArrowDown');
      const first = await page.evaluate(() => document.activeElement?.textContent);
      await page.keyboard.press('ArrowDown');
      const second = await page.evaluate(() => document.activeElement?.textContent);
      await page.screenshot({ path: join(OUT, 'admin-menu-open-1366.png') });
      await page.keyboard.press('Escape');
      const back = await page.evaluate(() => document.activeElement?.textContent?.trim());
      const expanded = await btn.getAttribute('aria-expanded');
      check(first === 'Alerts' && second === 'Outbox' && back === 'Monitoring' && expanded === 'false', `menu keyboard: ↓ opens (${first}), ↓ moves (${second}), Esc closes and returns focus (${back})`);
      await page.keyboard.press('Control+k');
      await page.getByRole('dialog', { name: 'Search the portal' }).waitFor();
      await page.keyboard.type('audit');
      await page.keyboard.press('Enter');
      await page.waitForURL(/\/audit$/);
      check(true, 'command palette: Ctrl+K → "audit" → Enter opens /audit');
    }
    await page.context().close();
  }

  // Mobile: hamburger.
  {
    const page = await newPage(browser, 390, 'admin@demo.in');
    await page.goto(`${WEB}/dashboard`);
    await page.getByTestId('as-of').waitFor();
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('button', { name: 'Administration' }).click();
    await page.getByRole('link', { name: 'Rules' }).waitFor();
    await page.screenshot({ path: join(OUT, 'admin-menu-mobile-390.png') });
    await noOverflow(page, 'mobile menu open @390');
    await page.context().close();
  }

  // Post-Phase-09 additions inside the new shell.
  {
    const width = 1366;
    const page = await newPage(browser, width, 'officer@demo.in');
    await visit(page, `/instruments/${anyInstrument.id}`, 'passport', width, (p) => p.getByRole('tab').first().waitFor());
    check(await page.getByTestId('menu-bar').isVisible(), 'passport renders inside the shell (menu bar visible)');
    await visit(page, `/instruments/${anyInstrument.id}/print`, 'passport-print', width);
    await page.emulateMedia({ media: 'print' });
    check((await page.getByTestId('menu-bar').count()) === 0 || !(await page.getByTestId('menu-bar').isVisible()), 'printable passport: no shell in print');
    await page.emulateMedia({ media: 'screen' });
    let flagged = null;
    for (const i of pending) {
      await page.goto(`${WEB}/officer/review/${i.id}`);
      await page.getByRole('tab').first().waitFor();
      await page.waitForTimeout(300);
      if (await page.locator('section[aria-label="Advisory signals"]').count()) { flagged = i; break; }
    }
    check(!!flagged, `advisory flags shown on a review page inside the shell (${flagged?.referenceNo ?? 'none found'})`);
    if (flagged) await page.screenshot({ path: join(OUT, `review-advisory-${width}.png`), fullPage: true });
    await page.context().close();

    if (order?.orderNumber) {
      const appr = await newPage(browser, width, 'approver@demo.in');
      await visit(appr, `/releases/${released.id}/order`, 'release-order', width, (p) => p.getByText(/AICTE\/REL\//).first().waitFor());
      await appr.emulateMedia({ media: 'print' });
      await appr.screenshot({ path: join(OUT, `release-order-print-${width}.png`), fullPage: true });
      check(!(await appr.getByTestId('menu-bar').isVisible()), 'release order: shell hidden in print');
      await appr.context().close();
      const pub = await newPage(browser, width);
      await visit(pub, `/verify/${encodeURIComponent(order.orderNumber)}`, 'verify', width, (p) => p.getByTestId('verify-verdict').waitFor());
      check((await pub.getByTestId('verify-verdict').textContent()).includes('Valid'), `QR verify page: ${order.orderNumber} → Valid, inside the public shell`);
      await pub.context().close();
      const pub390 = await newPage(browser, 390);
      await visit(pub390, `/verify/${encodeURIComponent(order.orderNumber)}`, 'verify', 390, (p) => p.getByTestId('verify-verdict').waitFor());
      await pub390.context().close();
    } else check(false, 'a released request with an order number exists in the seed');
  }

  await browser.close();
  check(consoleErrors.length === 0, `no console errors${consoleErrors.length ? `:\n  ${consoleErrors.join('\n  ')}` : ''}`);
  console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll UI checks passed');
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
