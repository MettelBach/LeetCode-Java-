/**
 * End-to-end smoke test of the main user flows in a real browser.
 *   BASE=http://localhost:3001 ADMIN_EMAIL=... ADMIN_PASSWORD=... node e2e/smoke.mjs
 * Requires Playwright (npx playwright) and a running server with an empty or test data dir.
 */
import { chromium } from 'playwright';

const base = process.env.BASE ?? 'http://localhost:3001';
const email = `e2e${Date.now()}@test.pl`;
const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n')[0]]);
  }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => localStorage.setItem('sellhub_lang', 'en'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await step('register account with demo data', async () => {
  await page.goto(`${base}/register`);
  await page.getByLabel('Company / store name').fill('E2E Sklep');
  await page.getByLabel('Your name').fill('Ewa Testowa');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password').fill('Kawa-Czarna-41');
  await page.getByRole('checkbox').nth(1).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByText('Hello, Ewa Testowa!').waitFor({ timeout: 30000 });
});

await step('order list shows demo orders', async () => {
  await page.goto(`${base}/orders`);
  await page.locator('.order-no').first().waitFor();
});

await step('advanced search filters orders', async () => {
  await page.getByRole('button', { name: 'Advanced search' }).click();
  await page.getByLabel('Order source').selectOption('allegro');
  await page.getByRole('button', { name: 'Search' }).last().click();
  await page.getByText('Order source: allegro').waitFor();
});

await step('add manual order', async () => {
  await page.goto(`${base}/orders/new`);
  await page.getByPlaceholder('Search inventory: name, SKU, EAN...').fill('Kawa');
  await page.getByRole('button', { name: /Kawa ziarnista/ }).click();
  await page.getByLabel('Name and surname').first().fill('Jan E2E');
  await page.getByLabel('Address').first().fill('ul. Testowa 5');
  await page.getByLabel('Postal code').first().fill('00-950');
  await page.getByLabel('City').first().fill('Warszawa');
  await page.getByRole('button', { name: 'Add order' }).last().click();
  await page.getByText('Order information', { exact: true }).waitFor();
});

await step('change status in order card', async () => {
  await page.locator('.status-select').click();
  await page.locator('.dd-menu .dd-item', { hasText: 'To send' }).click();
  await page.getByRole('button', { name: 'Change' }).click();
  await page.getByText('Status changed').first().waitFor();
});

await step('create shipment from order card', async () => {
  await page.getByRole('button', { name: 'Pack' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create shipment' }).click();
  await page.locator('table').getByText('InPost Paczkomaty').first().waitFor();
});

await step('issue invoice from order card', async () => {
  const popup = page.waitForEvent('popup').catch(() => null);
  await page.getByRole('button', { name: 'Issue an invoice' }).click();
  await page.getByText('Document issued').waitFor();
  const p = await popup;
  await p?.close();
});

await step('create support ticket', async () => {
  await page.goto(`${base}/help/tickets/new`);
  await page.getByLabel('Subject').fill('Test e2e ticket');
  await page.getByLabel('Describe the problem').fill('Something to check by support.');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByText('#').first().waitFor();
});

await step('warehouse document PZ', async () => {
  await page.goto(`${base}/products/documents/new`);
  await page.getByPlaceholder('Add product: name, SKU, EAN...').fill('Kawa');
  await page.getByRole('button', { name: /Kawa ziarnista/ }).click();
  await page.getByRole('button', { name: 'Confirm document' }).click();
  await page.getByText('Document confirmed — stock updated').waitFor();
});

await step('packing station: scan all products of an order', async () => {
  await page.goto(`${base}/orders/packing`);
  const box = page.getByLabel('Scan EAN or SKU…');
  await box.waitFor();
  await box.fill('NO-SUCH-CODE');
  await box.press('Enter');
  await page.getByText('Code NO-SUCH-CODE is not in this order').waitFor();
  const rows = page.locator('.tbl tbody tr');
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const sku = ((await rows.nth(i).locator('.text-muted').innerText()).match(/SKU: ([^ ·]+)/) || [])[1];
    const need = Number((await rows.nth(i).locator('td').nth(3).innerText()).split('/')[1]);
    for (let k = 0; k < need; k++) {
      await box.fill(sku);
      await box.press('Enter');
    }
  }
  await page.getByRole('button', { name: 'Order packed' }).click();
  await page.getByText('Order packed', { exact: true }).last().waitFor();
});

await step('API token: generate and call the REST API', async () => {
  await page.goto(`${base}/settings/api`);
  await page.getByRole('button', { name: 'Generate token' }).first().click();
  await page.locator('.modal input').fill('E2E');
  await page.locator('.modal').getByRole('button', { name: 'Generate', exact: true }).click();
  const token = await page.locator('.modal input[readonly]').inputValue();
  await page.getByRole('button', { name: 'Done' }).click();
  const res = await fetch(`${base}/api/v1/orders?per_page=1`, { headers: { 'X-Api-Token': token } });
  if (res.status !== 200) throw new Error(`REST API returned ${res.status}`);
});

if (process.env.ADMIN_EMAIL) {
  await step('support panel: take ticket and log in to the account', async () => {
    const admin = await ctx.newPage();
    await admin.goto(`${base}/admin/login`);
    await admin.getByLabel('E-mail').fill(process.env.ADMIN_EMAIL);
    await admin.getByLabel('Password').fill(process.env.ADMIN_PASSWORD);
    await admin.getByRole('button', { name: 'Log in' }).click();
    await admin.getByText('Platform overview').waitFor();
    await admin.goto(`${base}/admin/tickets`);
    await admin.getByText('Test e2e ticket').click();
    await admin.getByRole('button', { name: 'Take ticket' }).click();
    await admin.getByPlaceholder('Reply to the client...').fill('Hello from support');
    await admin.getByRole('button', { name: 'Send' }).last().click();
    await admin.getByText('Hello from support').waitFor();
    const popup = admin.waitForEvent('popup');
    await admin.getByRole('button', { name: 'Log in to the account' }).click();
    await admin.getByLabel('Reason (e.g. ticket number)').fill('e2e check');
    await admin.getByRole('button', { name: 'Open the client panel' }).click();
    const client = await popup;
    await client.getByText(/Support session/).waitFor({ timeout: 15000 });
  });
}

console.log(results.map((r) => r.join(' — ')).join('\n'));
if (errors.length) console.log('page errors:', errors);
await browser.close();
process.exit(results.some((r) => r[0] === 'FAIL') || errors.length ? 1 : 0);
