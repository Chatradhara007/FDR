// Clicks through docs/demo-script.md in a real browser and saves a screenshot per step to e2e/screenshots/.
//
// Needs the whole stack running in demo mode (`npm run dev`, or `docker compose up`) and Playwright with Chromium
// (`npm i -g playwright && npx playwright install chromium`, or any Playwright already on the machine).
// Run: `node e2e/demo.mjs` (E2E_WEB=http://localhost:5173, E2E_API=http://localhost:3000/api/v1 to override).
// Exit code 1 when any step failed; console errors are listed at the end.

import { mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed: npm i -g playwright && npx playwright install chromium');
  process.exit(2);
}

const WEB = process.env.E2E_WEB ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:3000/api/v1';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'screenshots');
const PASSWORD = 'Demo@123';
const A1 = 'SBIN/FDR/2026/00731';
const A2 = 'CNRB/FD/2025/11842';
const A4_NEW = 'UBIN/FDR/2026/40977';

const results = [];
const consoleErrors = [];
let shot = 0;

async function api(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json?.message ?? ''}`);
  return json;
}

const tokenFor = async (email) => (await api('/auth/login', { method: 'POST', body: { email, password: PASSWORD } })).token;

async function screenshot(page, name) {
  shot += 1;
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `${String(shot).padStart(2, '0')}-${name}.png`), fullPage: true });
}

/** Every page opened; all open ones are captured when a step fails. */
const allPages = [];

async function step(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - started, error: err.message.split('\n')[0] });
    for (const [i, p] of allPages.entries()) {
      if (p.isClosed()) continue;
      await p.screenshot({ path: join(OUT, `FAILED-${name.split('.')[0]}-${i}.png`), fullPage: true }).catch(() => {});
    }
    console.log(`✗ ${name}: ${err.message.split('\n')[0]}`);
  }
}

/** A fresh browser context signed in through the login page's demo "Sign in as" button. */
async function signIn(browser, label, role) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push({ role, url: page.url(), text: msg.text() });
  });
  page.on('pageerror', (err) => consoleErrors.push({ role, url: page.url(), text: `pageerror: ${err.message}` }));
  allPages.push(page);
  await page.goto(`${WEB}/login`);
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  return page;
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ids = {};
  const adminToken = await tokenFor('admin@demo.in');

  // Before you start: Admin → Demo tools → Reset demo data.
  let admin;
  await step('0. Admin resets the demo data from Demo tools', async () => {
    admin = await signIn(browser, 'Admin', 'admin');
    await admin.goto(`${WEB}/admin/demo`);
    await admin.getByRole('button', { name: 'Reset demo data' }).click();
    await admin.getByRole('button', { name: 'Reset everything' }).click();
    await admin.getByText(/Demo data reset in/).waitFor({ timeout: 60_000 });
    await admin.getByTestId('demo-ribbon').waitFor();
    await screenshot(admin, 'demo-tools-after-reset');
  });
  const anchors = await api('/demo/anchors', { token: adminToken });
  const a1 = anchors.find((a) => a.code === 'A1').bankRecord;

  let inst1;
  await step('1. Institution 1 submits A1 with a wrong amount (₹25,00,000)', async () => {
    inst1 = await signIn(browser, 'Institution 1', 'institution');
    await inst1.goto(`${WEB}/institution/instruments/new`);
    await inst1.locator('#referenceNo').fill(A1);
    await inst1.locator('#issuingBank').fill('State Bank of India');
    await inst1.locator('#branch').fill('Main Branch');
    await inst1.locator('#amount').fill('25,00,000');
    await inst1.locator('#issueDate').fill(a1.issueDate);
    await inst1.locator('#maturityDate').fill(a1.maturityDate);
    await inst1.locator('#beneficiaryName').fill(a1.beneficiaryName);
    await inst1.getByLabel('Lien marked in favour of AICTE').check();
    await screenshot(inst1, 'a1-details');
    await inst1.getByRole('button', { name: 'Next' }).click();
    for (const [type, name] of [['FDR_COPY', 'fdr-copy'], ['BANK_LETTER', 'bank-letter']]) {
      const res = await fetch(`${API}/demo/files/${name}`, { headers: { Authorization: `Bearer ${adminToken}` } });
      await inst1.locator('#docType').selectOption(type);
      await inst1.locator('#file').setInputFiles({ name: `A1-${name}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(await res.arrayBuffer()) });
      await inst1.getByRole('button', { name: 'Upload', exact: true }).click();
      await inst1.getByText(`A1-${name}.pdf`).first().waitFor();
    }
    await screenshot(inst1, 'a1-documents');
    await inst1.getByRole('button', { name: 'Next' }).click();
    await inst1.getByRole('button', { name: 'Submit for scrutiny' }).click();
    await inst1.waitForURL(/\/instruments\/[0-9a-f-]{36}$/);
    ids.a1 = inst1.url().split('/').pop();
    await inst1.getByRole('tab', { name: 'Fields' }).click();
    await inst1.getByText('Claimed by institution').first().waitFor();
    await screenshot(inst1, 'a1-passport-claimed');
  });

  let officer;
  await step('2. Officer verifies A1: mismatch on amount, Accept disabled, returned', async () => {
    officer = await signIn(browser, 'Officer', 'officer');
    await officer.goto(`${WEB}/officer/queue`);
    await officer.getByRole('row', { name: new RegExp(A1.replace(/\//g, '\\/')) }).getByRole('button', { name: 'Claim' }).click();
    await officer.goto(`${WEB}/officer/review/${ids.a1}`);
    await officer.getByRole('button', { name: 'Verify with bank' }).click();
    await officer.getByText('Institution claimed').first().waitFor();
    await officer.getByText('Bank-confirmed').first().waitFor();
    const accept = officer.getByRole('button', { name: 'Accept', exact: true });
    if (!(await accept.isDisabled())) throw new Error('Accept should be disabled after the mismatch');
    await screenshot(officer, 'a1-review-mismatch');
    await officer.getByRole('button', { name: 'Return to institution' }).first().click();
    await officer.getByRole('dialog').getByRole('textbox').first().fill('Amount does not match bank record');
    await officer.getByRole('dialog').getByRole('button', { name: /Return/ }).click();
    await officer.getByText(/Returned/).first().waitFor();
    await screenshot(officer, 'a1-returned');
  });

  await step('3. Dashboard (approver)', async () => {
    const approver = await signIn(browser, 'Approver', 'approver');
    await approver.goto(`${WEB}/dashboard`);
    await approver.getByText(/As of/).first().waitFor();
    await approver.getByText('Expiring').first().waitFor();
    await screenshot(approver, 'dashboard');
    await approver.context().close();
  });

  await step('4. Admin jumps +7 days: A2 becomes Expiring, reminders in the outbox', async () => {
    await admin.goto(`${WEB}/dashboard`);
    await admin.getByRole('button', { name: '+7d' }).click();
    await admin.getByText(/status change/).first().waitFor();
    await screenshot(admin, 'clock-plus-7');
    const a2 = (await api(`/instruments?q=${encodeURIComponent(A2)}`, { token: adminToken })).items[0];
    if (a2.status !== 'EXPIRING') throw new Error(`A2 is ${a2.status}`);
    await admin.goto(`${WEB}/instruments/${a2.id}`);
    await admin.getByText('Expiring').first().waitFor();
    await screenshot(admin, 'a2-expiring');
    await admin.goto(`${WEB}/admin/outbox`);
    await admin.getByText(/Escalation L2/).first().waitFor();
    await screenshot(admin, 'outbox');
    const mails = (await api('/outbox?pageSize=100', { token: adminToken })).items;
    if (!mails.some((m) => (m.subject + m.body).includes(A2))) throw new Error('no outbox email for A2');
    await officer.goto(`${WEB}/officer`);
    await officer.getByText(/Why this order/).first().waitFor();
    await screenshot(officer, 'my-day-after-jump');
  });

  await step('5. Approver sees A3 escalated (L2); A6 lapsed and escalated to admin (L3)', async () => {
    const approver = await signIn(browser, 'Approver', 'approver');
    await approver.goto(`${WEB}/alerts`);
    await approver.getByText('HDFC/FD/2026/55210').first().waitFor();
    await approver.getByText(/Escalated to approver/).first().waitFor();
    await screenshot(approver, 'approver-alerts-escalated');
    await approver.context().close();
    await admin.goto(`${WEB}/alerts`);
    await admin.getByText('ICIC/FD/2023/09981').first().waitFor();
    await screenshot(admin, 'admin-alerts-l3');
  });

  await step('6. Institution 1 renews A4; officer verifies and accepts; chain shows the overlap; A8 gap', async () => {
    const a4 = anchors.find((a) => a.code === 'A4');
    await inst1.goto(`${WEB}/instruments/${a4.instrumentId}`);
    await inst1.getByRole('button', { name: 'Renew' }).click();
    await inst1.waitForURL(/\/edit$/);
    ids.a4new = inst1.url().split('/').at(-2);
    await inst1.locator('#referenceNo').fill(A4_NEW);
    await inst1.locator('#issueDate').fill(a4.bankRecord.issueDate);
    await inst1.locator('#maturityDate').fill(a4.bankRecord.maturityDate);
    await inst1.locator('#amount').fill('35,00,000');
    await inst1.getByLabel('Lien marked in favour of AICTE').check();
    await inst1.getByRole('button', { name: 'Next' }).click();
    for (const [type, name] of [['FDR_COPY', 'fdr-copy'], ['BANK_LETTER', 'bank-letter']]) {
      const res = await fetch(`${API}/demo/files/${name}`, { headers: { Authorization: `Bearer ${adminToken}` } });
      await inst1.locator('#docType').selectOption(type);
      await inst1.locator('#file').setInputFiles({ name: `A4-renewal-${name}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(await res.arrayBuffer()) });
      await inst1.getByRole('button', { name: 'Upload', exact: true }).click();
      await inst1.getByText(`A4-renewal-${name}.pdf`).first().waitFor();
    }
    await inst1.getByRole('button', { name: 'Next' }).click();
    await inst1.getByRole('button', { name: 'Submit for scrutiny' }).click();
    await inst1.waitForURL(/\/instruments\/[0-9a-f-]{36}$/);
    await officer.goto(`${WEB}/officer/queue`);
    await officer.getByRole('row', { name: new RegExp(A4_NEW.replace(/\//g, '\\/')) }).getByRole('button', { name: 'Claim' }).click();
    await officer.goto(`${WEB}/officer/review/${ids.a4new}`);
    await officer.getByRole('button', { name: 'Verify with bank' }).click();
    await officer.getByRole('button', { name: 'Accept', exact: true }).and(officer.locator(':enabled')).waitFor();
    await officer.getByRole('button', { name: 'Accept', exact: true }).click();
    await officer.getByText('Active').first().waitFor();
    await inst1.goto(`${WEB}/instruments/${ids.a4new}`);
    await inst1.getByRole('tab', { name: 'Chain' }).click();
    await inst1.getByText(/overlap/).first().waitFor();
    await screenshot(inst1, 'a4-chain-overlap');
    const a8 = anchors.find((a) => a.code === 'A8');
    await officer.goto(`${WEB}/instruments/${a8.instrumentId}`);
    await officer.getByRole('tab', { name: 'Chain' }).click();
    await officer.getByText(/12-day gap/).first().waitFor();
    await screenshot(officer, 'a8-chain-gap');
  });

  await step('7. A5 release: blocked → bank correction → re-verify → recommend → approve → order', async () => {
    const a5 = anchors.find((a) => a.code === 'A5');
    const req = (await api(`/release-requests?instrumentId=${a5.instrumentId}`, { token: adminToken })).items[0];
    await officer.goto(`${WEB}/officer/releases/${req.id}`);
    await officer.getByText(/Release blocked/).first().waitFor();
    if (!(await officer.getByRole('button', { name: 'Recommend' }).isDisabled())) throw new Error('Recommend should be disabled');
    await screenshot(officer, 'a5-release-blocked');
    await admin.goto(`${WEB}/admin/demo`);
    await admin.getByRole('button', { name: /A5: bank confirms/ }).click();
    await admin.getByText(/corrected: amount/).first().waitFor();
    await screenshot(admin, 'bank-correction');
    await officer.reload();
    await officer.getByRole('button', { name: 'Re-verify with bank' }).click();
    await officer.getByRole('button', { name: 'Recommend' }).and(officer.locator(':enabled')).waitFor({ timeout: 15_000 });
    await screenshot(officer, 'a5-unblocked');
    await officer.getByRole('button', { name: 'Recommend' }).click();
    await officer.getByRole('dialog').getByRole('textbox').first().fill('Bank corrected its record; all conditions met.');
    await officer.getByRole('dialog').getByRole('button', { name: 'Recommend' }).click();
    await officer.getByText(/Recommended/).first().waitFor();
    const approver = await signIn(browser, 'Approver', 'approver');
    await approver.goto(`${WEB}/approver/releases/${req.id}`);
    await approver.getByText(/competent authority/).first().waitFor();
    await screenshot(approver, 'a5-decision');
    await approver.getByRole('button', { name: 'Approve', exact: true }).click();
    await approver.getByRole('dialog').getByRole('textbox').first().fill('Approved after the bank correction.');
    await approver.locator('#approve-refund').fill('PFMS/RF/2026/0999');
    await approver.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
    await approver.getByText('Released').first().waitFor();
    await approver.goto(`${WEB}/releases/${req.id}/order`);
    await approver.getByText(/AICTE\/REL\//).first().waitFor();
    await screenshot(approver, 'a5-release-order');
    await approver.context().close();
  });

  await step('8. Auditor: integrity verified → admin tampers → integrity fails', async () => {
    const auditor = await signIn(browser, 'Auditor', 'auditor');
    await auditor.goto(`${WEB}/audit`);
    await auditor.getByText(/Log integrity verified/).waitFor();
    await screenshot(auditor, 'audit-ok');
    await auditor.goto(`${WEB}/instruments/${ids.a1}`);
    await auditor.getByText('Bank verification: mismatch on amount').first().waitFor();
    await screenshot(auditor, 'a1-timeline');
    await admin.goto(`${WEB}/admin/demo`);
    await admin.getByRole('button', { name: 'Tamper with one event' }).click();
    await admin.getByText(/altered/).first().waitFor();
    await auditor.goto(`${WEB}/audit`);
    await auditor.getByRole('button', { name: 'Check again' }).click().catch(() => {});
    await auditor.getByText(/Integrity check failed at event #/).waitFor();
    await screenshot(auditor, 'audit-tampered');
    await api('/demo/tamper/undo', { token: adminToken, method: 'POST' });
  });

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} steps passed; screenshots in ${OUT}`);
  for (const f of failed) console.log(`FAILED ${f.name}: ${f.error}`);
  if (consoleErrors.length) {
    console.log(`\n${consoleErrors.length} console error(s):`);
    for (const e of consoleErrors) console.log(`  [${e.role}] ${e.url}\n    ${e.text}`);
  } else {
    console.log('No console errors.');
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
