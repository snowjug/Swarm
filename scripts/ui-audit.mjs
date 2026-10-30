// Reproducible UI audit: drives the real application in a real browser at four
// viewports, records layout/accessibility metrics and screenshots, and exercises
// error conditions. It asserts nothing; it reports findings for human review.
//
//   npm run build && npm run audit:ui
//
// With no AUDIT_BASE it starts the built application itself, on a free port, in local rules mode and
// with an empty database, waits until it answers its health check, and stops it afterwards. To audit
// a server that is already running instead:
//
//   AUDIT_BASE=http://127.0.0.1:3001 AUDIT_OUT=test-results/ui-audit node scripts/ui-audit.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';

let BASE = process.env.AUDIT_BASE ?? '';
const OUT = process.env.AUDIT_OUT ?? 'test-results/ui-audit';
const CHANNEL = process.env.PW_CHANNEL ?? 'msedge';
const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '390x844', width: 390, height: 844, mobile: true },
];
mkdirSync(OUT, { recursive: true });

const report = {
  base: BASE,
  generatedAt: new Date().toISOString(),
  states: [],
  findings: [],
  errors: [],
};

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** Starts the built application and returns once it answers; a server that never does fails the audit. */
async function startServer() {
  const port = await freePort();
  const data = mkdtempSync(join(tmpdir(), 'swarm-audit-'));
  const child = spawn(process.execPath, ['dist/backend/src/index.js'], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: data,
      AI_PROVIDER: 'none',
      LOG_LEVEL: 'warn',
      RATE_LIMIT_SCALE: '100',
    },
    stdio: 'ignore',
  });
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (exited)
      throw new Error('The application exited before it answered. Run npm run build first.');
    if (Date.now() > deadline)
      throw new Error('The application did not answer within 120 seconds.');
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return {
    base,
    stop() {
      child.kill();
      rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

function collectLayout() {
  const vw = window.innerWidth;
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      Number(style.opacity) > 0
    );
  };
  const label = (element) =>
    element.tagName.toLowerCase() +
    (element.id ? `#${element.id}` : '') +
    (typeof element.className === 'string' && element.className.trim()
      ? `.${element.className.trim().split(/\s+/).slice(0, 2).join('.')}`
      : '');
  const insideScroller = (element) => {
    for (let node = element.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth) return true;
    }
    return false;
  };
  const all = [...document.querySelectorAll('body *')].filter(visible);
  const wide = all
    .filter(
      (element) =>
        !element.closest('svg') &&
        !insideScroller(element) &&
        element.getBoundingClientRect().right > vw + 1,
    )
    .slice(0, 6)
    .map(
      (element) => `${label(element)} right=${Math.round(element.getBoundingClientRect().right)}`,
    );
  const truncated = all
    .filter((element) => {
      if (element.closest('.sr-only')) return false;
      const style = getComputedStyle(element);
      return (
        /(hidden|clip)/.test(style.overflowX + style.overflowY) &&
        element.scrollWidth > element.clientWidth + 1 &&
        (element.textContent ?? '').trim().length > 0
      );
    })
    .slice(0, 8)
    .map(
      (element) =>
        `${label(element)} "${(element.textContent ?? '').trim().slice(0, 40)}" title=${Boolean(element.title)}`,
    );
  const smallText = all
    .filter((element) => {
      if (element.closest('svg, .sr-only')) return false;
      const own = [...element.childNodes].some(
        (node) => node.nodeType === 3 && node.textContent.trim().length > 1,
      );
      return own && Number.parseFloat(getComputedStyle(element).fontSize) < 11;
    })
    .slice(0, 6)
    .map((element) => `${label(element)} ${getComputedStyle(element).fontSize}`);
  const interactive = all.filter(
    (element) =>
      !element.closest('.sr-only') &&
      element.matches(
        'button, a[href], input:not([type=hidden]), select, textarea, [role=tab], [role=checkbox], summary',
      ),
  );
  const smallTargets = interactive
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width < 24 || rect.height < 24;
    })
    .slice(0, 8)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return `${label(element)} ${Math.round(rect.width)}x${Math.round(rect.height)}`;
    });
  const unnamed = interactive
    .filter((element) => {
      const name =
        element.getAttribute('aria-label') ||
        element.getAttribute('aria-labelledby') ||
        element.getAttribute('title') ||
        (element.textContent ?? '').trim() ||
        (element.labels && element.labels.length) ||
        (element.type === 'file' ? 'file' : '');
      return !name;
    })
    .slice(0, 6)
    .map(label);
  const svgText = [...document.querySelectorAll('svg text')].filter(visible);
  const graphCircles = [...document.querySelectorAll('.graph-surface svg circle')].filter(visible);
  // SVG text is scaled by its viewBox, so the rendered size is the computed size times the scale.
  const svgPx = svgText.map(
    (element) =>
      Number.parseFloat(getComputedStyle(element).fontSize) * (element.getScreenCTM()?.a ?? 1),
  );
  const rects = svgText.map((element) => element.getBoundingClientRect());
  let collisions = 0;
  for (let a = 0; a < rects.length; a += 1) {
    for (let b = a + 1; b < rects.length; b += 1) {
      const x = Math.min(rects[a].right, rects[b].right) - Math.max(rects[a].left, rects[b].left);
      const y = Math.min(rects[a].bottom, rects[b].bottom) - Math.max(rects[a].top, rects[b].top);
      const smaller = Math.min(rects[a].width * rects[a].height, rects[b].width * rects[b].height);
      if (x > 0 && y > 0 && smaller > 0 && (x * y) / smaller > 0.3) collisions += 1;
    }
  }
  return {
    viewportWidth: vw,
    documentWidth: document.documentElement.scrollWidth,
    horizontalOverflow: document.documentElement.scrollWidth > vw + 1,
    wide,
    truncated,
    smallText,
    smallTargets,
    unnamed,
    svgLabels: svgText.length,
    graphNodes: graphCircles.length,
    svgLabelCollisions: collisions,
    minSvgLabelPx: svgPx.length ? Math.round(Math.min(...svgPx) * 10) / 10 : null,
  };
}

async function journey(browser, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: Boolean(viewport.mobile),
    hasTouch: Boolean(viewport.mobile),
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  // Generous on purpose: a busy machine slows a first page load by many seconds, and a timeout
  // there says nothing about the application. What the audit reports are the findings.
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(90000);
  page.on('console', (message) => {
    if (message.type() === 'error')
      report.errors.push({
        viewport: viewport.name,
        kind: 'console',
        text: message.text().slice(0, 200),
      });
  });
  page.on('pageerror', (error) =>
    report.errors.push({
      viewport: viewport.name,
      kind: 'pageerror',
      text: String(error).slice(0, 200),
    }),
  );
  const step = async (name, action) => {
    try {
      await action();
    } catch (error) {
      report.findings.push({
        viewport: viewport.name,
        step: name,
        kind: 'step-failed',
        detail: String(error.message).split('\n')[0].slice(0, 220),
      });
    }
  };
  const snap = async (name, options = {}) => {
    await page.waitForTimeout(350);
    const file = `${OUT}/${viewport.name}-${name}.png`;
    await page.screenshot({ path: file, fullPage: Boolean(options.full) });
    const layout = await page.evaluate(collectLayout);
    const axe = await new AxeBuilder({ page }).analyze();
    report.states.push({
      viewport: viewport.name,
      state: name,
      url: page.url().replace(BASE, ''),
      file,
      layout,
      axe: axe.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.length,
        example: violation.nodes[0]?.target?.join(' ').slice(0, 120),
      })),
    });
  };

  await page.goto(BASE);
  await page.getByRole('button', { name: 'Build Graph', exact: true }).waitFor({ timeout: 15000 });
  await snap('01-entry');
  await step('starter input', async () => {
    await page.getByRole('button', { name: 'Load fictional starter input' }).click();
    await page.getByRole('spinbutton', { name: 'Fictional proxies' }).fill('8');
    await page.getByRole('spinbutton', { name: 'Rounds / platform' }).fill('4');
  });
  await snap('02-entry-filled', { full: viewport.mobile });
  await step('build graph', async () => {
    await page.getByRole('button', { name: 'Build Graph', exact: true }).click();
    await page.getByRole('button', { name: /Prepare environment/ }).waitFor({ timeout: 20000 });
  });
  await snap('03-graph-stage');
  // One switcher is rendered: a 3-way view toggle when wide, a 2-way pane switch when narrow.
  const switcher = page.getByRole('group', { name: /^Console (view|pane)$/ });
  const modes = viewport.width <= 900 ? ['Graph', 'Workbench'] : ['Graph', 'Workbench', 'Split'];
  for (const mode of modes) {
    await step(`view mode ${mode}`, async () => {
      await switcher.getByRole('button', { name: mode, exact: true }).click();
      await page.waitForTimeout(400);
    });
    if (mode !== 'Split') await snap(`03-view-${mode.toLowerCase()}`);
  }
  await step('inspect graph', async () => {
    if (viewport.width <= 900)
      await switcher.getByRole('button', { name: 'Graph', exact: true }).click();
    await page.getByRole('combobox', { name: /Inspect node/ }).selectOption({ index: 1 });
    await page.getByRole('dialog').waitFor();
  });
  await snap('04-graph-inspect');
  await step('inspector closes with Escape', async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    if (await page.getByRole('dialog').count())
      throw new Error('Escape did not close the inspector dialog');
    if (viewport.width <= 900)
      await switcher.getByRole('button', { name: 'Workbench', exact: true }).click();
  });
  await step('prepare environment', async () => {
    await page.getByRole('button', { name: /Prepare environment/ }).click();
    await page.getByRole('button', { name: 'Start Simulation' }).waitFor({ timeout: 20000 });
  });
  await snap('05-environment', { full: viewport.mobile });
  await step('persona editor', async () => {
    await page
      .locator('summary')
      .filter({ hasText: /Synthetic/ })
      .first()
      .click();
    await page.waitForTimeout(300);
  });
  await snap('05b-persona-open', { full: viewport.mobile });
  await step('keyboard traversal', async () => {
    await page.evaluate(() => document.body.focus());
    const stops = [];
    for (let index = 0; index < 30; index += 1) {
      await page.keyboard.press('Tab');
      stops.push(
        await page.evaluate(() => {
          const element = document.activeElement;
          if (!element || element === document.body) return null;
          const style = getComputedStyle(element);
          const name =
            element.getAttribute('aria-label') ||
            (element.textContent || '').trim().slice(0, 30) ||
            element.tagName;
          const ring =
            (style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0) ||
            style.boxShadow !== 'none';
          return { name, ring };
        }),
      );
    }
    const reached = stops.filter(Boolean);
    const noRing = reached.filter((stop) => !stop.ring).map((stop) => stop.name);
    report.findings.push({
      viewport: viewport.name,
      step: 'keyboard traversal',
      kind: 'keyboard',
      detail: `${reached.length} focus stops in 30 Tab presses; ${noRing.length} without a visible focus indicator${noRing.length ? `: ${noRing.slice(0, 6).join(' | ')}` : ''}`,
    });
  });
  await step('run simulation', async () => {
    await page.getByRole('button', { name: 'Start Simulation' }).click();
    await page.getByRole('button', { name: /Generate Report/ }).waitFor({ timeout: 30000 });
  });
  await snap('06-simulation', { full: viewport.mobile });
  await step('generate report', async () => {
    await page.getByRole('button', { name: /Generate Report/ }).click();
    await page.getByRole('button', { name: /Open Interaction/ }).waitFor({ timeout: 30000 });
  });
  await snap('07-report', { full: viewport.mobile });
  await step('interaction', async () => {
    await page.getByRole('button', { name: /Open Interaction/ }).click();
    await page.getByRole('tab', { name: /Survey/ }).waitFor({ timeout: 10000 });
  });
  await snap('08-interaction', { full: viewport.mobile });
  await context.close();
}

async function errorConditions(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(90000);
  const record = (step, detail) =>
    report.findings.push({ viewport: '1440x900', step, kind: 'error-condition', detail });
  const ALERTS = '[role=alert], .notice-error, .notice-warning';
  const alerts = async () => (await page.locator(ALERTS).allInnerTexts()).join(' | ').slice(0, 260);
  // Waits for a message for as long as a slow machine needs. "(none)" is reported only after the
  // whole wait, so a finding means no message, not a message that was late.
  const shown = async () => {
    try {
      await page.locator(ALERTS).first().waitFor({ state: 'visible', timeout: 30000 });
    } catch {
      return '(none)';
    }
    return (await alerts()) || '(none)';
  };
  // Every case that expects a message starts on a fresh page, so that a message left by the one
  // before cannot be taken for the answer to this one.
  const fresh = async () => {
    await page.goto(BASE);
    await page.getByRole('button', { name: 'Build Graph', exact: true }).waitFor();
  };
  const errorCase = async (name, action) => {
    try {
      record(name, await action());
    } catch (error) {
      record(name, `harness failure: ${String(error.message).split('\n')[0].slice(0, 200)}`);
    }
  };
  await errorCase('unsupported file type (.exe)', async () => {
    await fresh();
    await page.locator('input[type=file]').setInputFiles({
      name: 'malware.exe',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('MZ binary'),
    });
    return `visible message: ${await shown()}`;
  });
  await errorCase('corrupt PDF', async () => {
    await fresh();
    await page.locator('input[type=file]').setInputFiles({
      name: 'broken.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nthis is not a valid pdf body'),
    });
    return `visible message: ${await shown()}`;
  });
  await errorCase('oversized PDF (2.1 MB)', async () => {
    await fresh();
    await page.locator('input[type=file]').setInputFiles({
      name: 'big.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc(2_100_000, 32),
    });
    return `visible message: ${await shown()}`;
  });
  await errorCase('empty form submit', async () => {
    await fresh();
    await page.getByRole('button', { name: 'Build Graph', exact: true }).click();
    return `visible message: ${await shown()}; url=${page.url().replace(BASE, '')}`;
  });
  await errorCase('unknown project id', async () => {
    await page.goto(`${BASE}/?project=00000000-0000-4000-8000-000000000000`);
    return `visible message: ${await shown()}`;
  });
  await errorCase('malformed project id', async () => {
    await page.goto(`${BASE}/?project=not-a-uuid`);
    return `visible message: ${await shown()}`;
  });
  await errorCase('API outage while loading', async () => {
    await page.route('**/api/**', (route) => route.abort());
    await page.goto(BASE);
    const text = await shown();
    await page.screenshot({ path: `${OUT}/err-api-outage.png` });
    await page.unroute('**/api/**');
    return `visible message: ${text}`;
  });
  await errorCase('server 429 on project creation', async () => {
    await fresh();
    await page.getByRole('button', { name: 'Load fictional starter input' }).click();
    await page.route('**/api/projects', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status: 429,
            contentType: 'application/json',
            body: JSON.stringify({
              error: {
                code: 'RATE_LIMITED',
                message: 'Too many requests. Wait a minute before retrying.',
              },
            }),
          })
        : route.continue(),
    );
    await page.getByRole('button', { name: 'Build Graph', exact: true }).click();
    const text = await shown();
    await page.screenshot({ path: `${OUT}/err-429.png` });
    await page.unroute('**/api/projects');
    return `visible message: ${text}`;
  });
  await errorCase('double-click Build Graph creates one project', async () => {
    const count = async () => (await (await page.request.get(`${BASE}/api/projects`)).json()).total;
    const before = await count();
    await fresh();
    await page.getByRole('button', { name: 'Load fictional starter input' }).click();
    await page.getByRole('button', { name: 'Build Graph', exact: true }).dblclick();
    // First wait until the project exists, however long that takes; then allow a second one the
    // time it would need. Proving that something did not happen needs a quiet period.
    const deadline = Date.now() + 30000;
    while ((await count()) <= before && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await page.waitForTimeout(2000);
    return `projects created by one double-click: ${(await count()) - before}`;
  });
  await context.close();
}

const own = process.env.AUDIT_BASE ? null : await startServer();
if (own) {
  BASE = own.base;
  report.base = BASE;
}
let browser;
try {
  browser = await chromium.launch({ channel: CHANNEL, headless: true });
  for (const viewport of VIEWPORTS) await journey(browser, viewport);
  await errorConditions(browser);
} finally {
  await browser?.close();
  own?.stop();
}
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
const axeTotals = {};
for (const state of report.states)
  for (const violation of state.axe) axeTotals[violation.id] = (axeTotals[violation.id] ?? 0) + 1;
console.log(
  JSON.stringify(
    {
      states: report.states.length,
      findings: report.findings.length,
      consoleErrors: report.errors.length,
      axeViolationKindsAcrossStates: axeTotals,
    },
    null,
    2,
  ),
);
