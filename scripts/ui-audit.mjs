// Reproducible UI audit: drives the real application in a real browser at five viewports and both themes,
// records layout and accessibility metrics and screenshots of every scene, and exercises error conditions.
// It asserts nothing; it reports findings for human review (the end-to-end specs are what fail a build).
//
//   npm run build && npm run audit:ui
//
// With no AUDIT_BASE it starts the built application itself, on a free port, in local rules mode and with an
// empty database, makes one complete project through the API (every stage, so that every scene has something real
// to show), waits until it answers its health check, and stops it afterwards. To audit a server that is already
// running, with a project that is already complete in it:
//
//   AUDIT_BASE=http://127.0.0.1:3001 AUDIT_PROJECT=<id> AUDIT_OUT=test-results/ui-audit node scripts/ui-audit.mjs
//
// VIEWPORTS=390x844,1440x900 and THEMES=dark narrow the run; PW_CHANNEL=msedge uses an installed Edge.
import { mkdirSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { makeProject, startServer } from './ui/fixture.mjs';

let BASE = process.env.AUDIT_BASE ?? '';
let PROJECT = process.env.AUDIT_PROJECT ?? '';
const OUT = process.env.AUDIT_OUT ?? 'test-results/ui-audit';
const CHANNEL = process.env.PW_CHANNEL || undefined;
const VIEWPORTS = (process.env.VIEWPORTS ?? '390x844,768x1024,1366x768,1440x900,1920x1080')
  .split(',')
  .map((size) => {
    const [width, height] = size.split('x').map(Number);
    return { name: size, width, height, mobile: width < 500 };
  });
const THEMES = (process.env.THEMES ?? 'light,dark').split(',');
mkdirSync(OUT, { recursive: true });

const report = {
  base: BASE,
  generatedAt: new Date().toISOString(),
  states: [],
  findings: [],
  errors: [],
};

// The places a person goes. `view` is the part of a scene; `wait` lets what moves settle before it is measured.
const STATES = [
  { name: 'ask', scene: null },
  { name: 'ground', scene: 'ground', full: true },
  { name: 'map', scene: 'map', wait: 1800 },
  { name: 'map-list', scene: 'map', view: 'list' },
  { name: 'simulate-live', scene: 'simulate', wait: 2500 },
  { name: 'simulate-network', scene: 'simulate', view: 'network', wait: 2000 },
  { name: 'simulate-timeline', scene: 'simulate', view: 'timeline' },
  { name: 'simulate-story', scene: 'simulate', view: 'story', full: true },
  { name: 'simulate-setup', scene: 'simulate', view: 'setup' },
  { name: 'compare', scene: 'compare', full: true, wait: 2000 },
  { name: 'decide', scene: 'decide', full: true, wait: 2000 },
  { name: 'decide-studio', scene: 'decide', view: 'studio' },
  { name: 'decide-report', scene: 'decide', view: 'report', full: true },
];

/** What is wrong with the page as it is drawn now: the same things a person would notice without a ruler. */
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
  // What is hidden on purpose from the eye and kept for a screen reader (a label that gives way to an icon on a narrow screen, a
  // skip link until it has focus): a box of a pixel or two, or clipped away. It is neither cut off nor too small to press.
  const hiddenOnPurpose = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width <= 2 || rect.height <= 2 || style.clipPath !== 'none' || style.clip !== 'auto'
    );
  };
  const wide = all
    .filter(
      (element) =>
        !element.closest('svg, .sw-aurora') &&
        !insideScroller(element) &&
        getComputedStyle(element).position !== 'fixed' &&
        element.getBoundingClientRect().right > vw + 1,
    )
    .slice(0, 6)
    .map(
      (element) => `${label(element)} right=${Math.round(element.getBoundingClientRect().right)}`,
    );
  const truncated = all
    .filter((element) => {
      if (element.closest('.sr-only') || hiddenOnPurpose(element)) return false;
      const style = getComputedStyle(element);
      return (
        /(hidden|clip)/.test(style.overflowX + style.overflowY) &&
        element.scrollWidth > element.clientWidth + 1 &&
        (element.textContent ?? '').trim().length > 0 &&
        style.textOverflow !== 'ellipsis'
      );
    })
    .slice(0, 8)
    .map((element) => `${label(element)} "${(element.textContent ?? '').trim().slice(0, 40)}"`);
  const smallText = all
    .filter((element) => {
      if (element.closest('svg, .sr-only')) return false;
      const own = [...element.childNodes].some(
        (node) => node.nodeType === 3 && node.textContent.trim().length > 1,
      );
      return own && Number.parseFloat(getComputedStyle(element).fontSize) < 12;
    })
    .slice(0, 6)
    .map((element) => `${label(element)} ${getComputedStyle(element).fontSize}`);
  const interactive = all.filter(
    (element) =>
      !element.closest('.sr-only') &&
      !hiddenOnPurpose(element) &&
      element.matches(
        'button, a[href], input:not([type=hidden]), select, textarea, [role=tab], [role=radio], [role=switch], [role=checkbox], summary',
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
    .filter(
      (element) =>
        !(
          element.getAttribute('aria-label') ||
          element.getAttribute('aria-labelledby') ||
          element.getAttribute('title') ||
          (element.textContent ?? '').trim() ||
          (element.labels && element.labels.length)
        ),
    )
    .slice(0, 6)
    .map(label);
  const svgText = [...document.querySelectorAll('svg text')].filter(visible);
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
    svgLabelCollisions: collisions,
    minSvgLabelPx: svgPx.length ? Math.round(Math.min(...svgPx) * 10) / 10 : null,
  };
}

const addressOf = (state) => {
  const query = new URLSearchParams();
  if (state.scene) {
    query.set('project', PROJECT);
    query.set('scene', state.scene);
    if (state.view) query.set('view', state.view);
  }
  const text = query.toString();
  return text ? `/?${text}` : '/';
};

async function settle(page, wait) {
  await page
    .waitForFunction(() => !document.querySelector('[aria-busy="true"], .sw-skeleton'), null, {
      timeout: 30000,
    })
    .catch(() => undefined);
  await page.waitForTimeout(wait ?? 1200);
}

/** Every scene, at one viewport and one theme. */
async function scenes(browser, viewport, theme) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.mobile,
    hasTouch: viewport.mobile,
    deviceScaleFactor: viewport.mobile ? 2 : 1,
  });
  await context.addInitScript((value) => window.localStorage.setItem('swarm.theme', value), theme);
  const page = await context.newPage();
  // Generous on purpose: a busy machine slows a first page load by many seconds, and a timeout there says nothing
  // about the application. What the audit reports are the findings.
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(90000);
  let current = '';
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning')
      report.errors.push({
        viewport: viewport.name,
        theme,
        state: current,
        kind: `console ${message.type()}`,
        text: message.text().slice(0, 200),
      });
  });
  page.on('pageerror', (error) =>
    report.errors.push({
      viewport: viewport.name,
      theme,
      state: current,
      kind: 'pageerror',
      text: String(error).slice(0, 200),
    }),
  );
  for (const state of STATES) {
    current = state.name;
    try {
      await page.goto(`${BASE}${addressOf(state)}`, { waitUntil: 'networkidle' });
      await settle(page, state.wait);
      const file = `${OUT}/${state.name}__${theme}__${viewport.name}.png`;
      await page.screenshot({ path: file, fullPage: Boolean(state.full) && viewport.mobile });
      const layout = await page.evaluate(collectLayout);
      // What enters at the foot of the window is drawn pale until it has scrolled in, so contrast is measured with the page
      // scrolled to its end, where everything above has arrived: a check made at the top would call that pale text a failure.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(700);
      const axe = await new AxeBuilder({ page }).analyze();
      report.states.push({
        viewport: viewport.name,
        theme,
        state: state.name,
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
    } catch (error) {
      report.findings.push({
        viewport: viewport.name,
        theme,
        step: state.name,
        kind: 'step-failed',
        detail: String(error.message).split('\n')[0].slice(0, 220),
      });
    }
  }
  await context.close();
}

/**
 * Whether the focused element shows where it is. Its own outline or shadow is the common way, but a ring may be drawn by the box
 * around it (the question field) or by a child (a node on the map), so what is asked is whether the pixels around it change when
 * it loses focus. `decoder` is an empty page of the same browser, to read the two pictures in.
 */
async function ringShown(page, decoder) {
  const clip = await page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return null;
    const box = element.getBoundingClientRect();
    const x = Math.max(0, box.x - 10);
    const y = Math.max(0, box.y - 10);
    const width = Math.min(window.innerWidth - x, box.width + 20);
    const height = Math.min(window.innerHeight - y, box.height + 20);
    window.__stop = element;
    return width > 4 && height > 4 ? { x, y, width, height } : null;
  });
  if (!clip) return false;
  await page.waitForTimeout(250);
  const focused = await page.screenshot({ clip });
  await page.evaluate(() => window.__stop.blur());
  await page.waitForTimeout(250);
  const blurred = await page.screenshot({ clip });
  await page.evaluate(() => window.__stop.focus());
  const changed = await decoder.evaluate(
    async ([first, second]) => {
      const read = async (data) => {
        const bitmap = await createImageBitmap(
          await (await fetch(`data:image/png;base64,${data}`)).blob(),
        );
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d');
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const [a, b] = await Promise.all([read(first), read(second)]);
      let count = 0;
      for (let at = 0; at < a.length; at += 4)
        if (
          Math.abs(a[at] - b[at]) +
            Math.abs(a[at + 1] - b[at + 1]) +
            Math.abs(a[at + 2] - b[at + 2]) >
          90
        )
          count += 1;
      return count;
    },
    [focused.toString('base64'), blurred.toString('base64')],
  );
  return changed >= 12;
}

/** A person with only a keyboard: how many stops, and whether each one shows where it is. */
async function keyboard(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const decoder = await context.newPage();
  await decoder.goto('about:blank');
  page.setDefaultTimeout(30000);
  for (const state of [
    STATES[0],
    STATES.find((item) => item.name === 'map'),
    STATES.find((item) => item.name === 'compare'),
    STATES.find((item) => item.name === 'decide'),
  ]) {
    await page.goto(`${BASE}${addressOf(state)}`, { waitUntil: 'networkidle' });
    await settle(page, 1500);
    await page.evaluate(() => document.body.focus());
    const stops = [];
    for (let index = 0; index < 30; index += 1) {
      await page.keyboard.press('Tab');
      const stop = await page.evaluate(() => {
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
      });
      if (stop && !stop.ring) stop.ring = await ringShown(page, decoder);
      stops.push(stop);
    }
    const reached = stops.filter(Boolean);
    const noRing = reached.filter((stop) => !stop.ring).map((stop) => stop.name);
    report.findings.push({
      viewport: '1440x900',
      step: state.name,
      kind: 'keyboard',
      detail: `${reached.length} focus stops in 30 Tab presses; ${noRing.length} without a visible focus indicator${noRing.length ? `: ${noRing.slice(0, 6).join(' | ')}` : ''}`,
    });
  }
  await context.close();
}

async function errorConditions(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(90000);
  const record = (step, detail) =>
    report.findings.push({ viewport: '1440x900', step, kind: 'error-condition', detail });
  const ALERTS = '[role=alert]';
  // Waits for a message for as long as a slow machine needs. "(none)" is reported only after the whole wait, so a
  // finding means no message, not a message that was late.
  const shown = async () => {
    try {
      await page.locator(ALERTS).first().waitFor({ state: 'visible', timeout: 30000 });
    } catch {
      return '(none)';
    }
    return ((await page.locator(ALERTS).allInnerTexts()).join(' | ') || '(none)').slice(0, 260);
  };
  const errorCase = async (name, action) => {
    try {
      record(name, await action());
    } catch (error) {
      record(name, `harness failure: ${String(error.message).split('\n')[0].slice(0, 200)}`);
    }
  };
  await errorCase('unknown project id', async () => {
    await page.goto(`${BASE}/?project=00000000-0000-4000-8000-000000000000`);
    return `visible message: ${await shown()}`;
  });
  await errorCase('malformed project id', async () => {
    await page.goto(`${BASE}/?project=not-a-uuid`);
    return `visible message: ${await shown()}`;
  });
  await errorCase('API outage while loading a project', async () => {
    await page.route('**/api/**', (route) => route.abort());
    await page.goto(`${BASE}/?project=${PROJECT}&scene=map`);
    const text = await shown();
    await page.screenshot({ path: `${OUT}/error-api-outage.png` });
    await page.unroute('**/api/**');
    return `visible message: ${text}`;
  });
  await errorCase('a locked scene opened by its address', async () => {
    await page.goto(`${BASE}/?project=${PROJECT}&scene=nonsense`);
    await settle(page, 1200);
    return `address after loading: ${page.url().replace(BASE, '')}`;
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
  if (!PROJECT) PROJECT = await makeProject(BASE);
  report.project = PROJECT;
  browser = await chromium.launch({ channel: CHANNEL, headless: true });
  for (const viewport of VIEWPORTS)
    for (const theme of THEMES) await scenes(browser, viewport, theme);
  await keyboard(browser);
  await errorConditions(browser);
} finally {
  await browser?.close();
  own?.stop();
}
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
const axeTotals = {};
for (const state of report.states)
  for (const violation of state.axe) axeTotals[violation.id] = (axeTotals[violation.id] ?? 0) + 1;
const layoutTotals = {
  overflow: 0,
  smallText: 0,
  smallTargets: 0,
  unnamed: 0,
  truncated: 0,
  svgCollisions: 0,
};
for (const { layout } of report.states) {
  layoutTotals.overflow += layout.horizontalOverflow ? 1 : 0;
  layoutTotals.smallText += layout.smallText.length ? 1 : 0;
  layoutTotals.smallTargets += layout.smallTargets.length ? 1 : 0;
  layoutTotals.unnamed += layout.unnamed.length ? 1 : 0;
  layoutTotals.truncated += layout.truncated.length ? 1 : 0;
  layoutTotals.svgCollisions += layout.svgLabelCollisions ? 1 : 0;
}
console.log(
  JSON.stringify(
    {
      states: report.states.length,
      statesWith: layoutTotals,
      findings: report.findings.length,
      consoleErrors: report.errors.length,
      axeViolationKindsAcrossStates: axeTotals,
    },
    null,
    2,
  ),
);
