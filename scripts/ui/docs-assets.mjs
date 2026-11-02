// The screenshots that README.md and docs/ show, taken from the real application with real engine output (local rules
// mode, an empty database, one project taken through every stage: scripts/ui/fixture.mjs). Nothing is composed or
// edited: every image is a page as a person would see it.
//
//   npm run build && node scripts/ui/docs-assets.mjs
//   DOCS_OUT=docs/assets node scripts/ui/docs-assets.mjs        write straight to the documentation
//
// The raw images are a few hundred KB each, and the README test (backend/test/readme.test.ts) allows 400 KB: run them
// through a PNG optimiser (for example `pngquant --quality=70-90 --ext .png --force`) before they are committed.
// DOCS_BASE and DOCS_PROJECT name a server that is already running and a project that is already complete in it.
// DOCS_ONLY=swarm-studio,swarm-dark takes only the pictures named.
import { mkdirSync, statSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { makeProject, openStudio, startServer } from './fixture.mjs';

const OUT = process.env.DOCS_OUT ?? 'test-results/docs-assets';
const only = process.env.DOCS_ONLY?.split(',').map((name) => name.trim());
const CHANNEL = process.env.PW_CHANNEL || undefined;
mkdirSync(OUT, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

/** The page at the moment of the picture: nothing is still loading, and what moves has had time to settle. */
async function settle(page, wait) {
  await page
    .waitForFunction(() => !document.querySelector('[aria-busy="true"], .sw-skeleton'), null, {
      timeout: 30000,
    })
    .catch(() => undefined);
  await page.waitForTimeout(wait);
}

/** The run is held on one round, so that the picture is the same every time it is taken. */
async function holdOnRound(page, stepsFromStart) {
  const pause = page.getByRole('button', { name: 'Pause' });
  if (await pause.count()) await pause.click();
  const slider = page.getByRole('slider', { name: 'Round' });
  await slider.focus();
  await slider.press('Home');
  for (let step = 0; step < stepsFromStart; step += 1) await slider.press('ArrowRight');
  await page.waitForTimeout(900);
}

const SHOTS = [
  { file: 'swarm-ask', size: DESKTOP, address: () => '/', wait: 1800 },
  { file: 'swarm-ground', size: DESKTOP, scene: 'ground', wait: 2200 },
  {
    file: 'swarm-map',
    size: DESKTOP,
    scene: 'map',
    wait: 2200,
    before: async (page) => {
      // The picture drifts a little, so the button is reached by the keyboard, as a person without a pointer would.
      await page
        .getByRole('group', { name: /how they relate/i })
        .getByRole('button')
        .first()
        .focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1200);
    },
  },
  {
    file: 'swarm-simulate-live',
    size: DESKTOP,
    scene: 'simulate',
    wait: 2000,
    before: (page) => holdOnRound(page, 4),
  },
  {
    file: 'swarm-simulate-network',
    size: DESKTOP,
    scene: 'simulate',
    view: 'network',
    wait: 2500,
  },
  { file: 'swarm-compare', size: DESKTOP, scene: 'compare', wait: 2400 },
  { file: 'swarm-decide', size: DESKTOP, scene: 'decide', wait: 2400 },
  {
    file: 'swarm-studio',
    size: DESKTOP,
    scene: 'decide',
    view: 'studio',
    wait: 2200,
    // Every other picture is of the project as it stands; the studio needs a report to work on.
    prepare: (address, id) => openStudio(address, id),
  },
  { file: 'swarm-mobile', size: PHONE, scene: 'map', wait: 2500 },
  {
    file: 'swarm-dark',
    size: DESKTOP,
    scene: 'simulate',
    theme: 'dark',
    wait: 2000,
    before: (page) => holdOnRound(page, 4),
  },
];

const own = process.env.DOCS_BASE ? null : await startServer();
const base = process.env.DOCS_BASE ?? own.base;
let browser;
try {
  const project = process.env.DOCS_PROJECT ?? (await makeProject(base));
  browser = await chromium.launch({ channel: CHANNEL, headless: true });
  for (const shot of SHOTS) {
    if (only && !only.includes(shot.file)) continue;
    await shot.prepare?.(base, project);
    const phone = shot.size.width < 500;
    const context = await browser.newContext({
      viewport: shot.size,
      isMobile: phone,
      hasTouch: phone,
      // 1, not 2: the headless browser does not paint a backdrop blur at a device-pixel ratio of 2 (the glass of the
      // bar, the dock and the sheets would show what is under it, unblurred), and a picture must be of what a person sees.
      deviceScaleFactor: 1,
    });
    await context.addInitScript(
      (theme) => window.localStorage.setItem('swarm.theme', theme),
      shot.theme ?? 'light',
    );
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(90000);
    const query = new URLSearchParams({ project, scene: shot.scene ?? '' });
    if (shot.view) query.set('view', shot.view);
    await page.goto(`${base}${shot.address ? shot.address() : `/?${query}`}`, {
      waitUntil: 'networkidle',
    });
    await settle(page, shot.wait);
    if (shot.before) await shot.before(page);
    const file = `${OUT}/${shot.file}.png`;
    await page.screenshot({ path: file });
    console.log(`${file}  ${Math.round(statSync(file).size / 1024)} KB`);
    await context.close();
  }
} finally {
  await browser?.close();
  own?.stop();
}
