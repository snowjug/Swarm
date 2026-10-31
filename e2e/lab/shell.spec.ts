import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  apiContext,
  expectNoAxeViolations,
  expectNoBrowserPaintedControls,
  expectNoHorizontalOverflow,
  expectReadableText,
  expectTargetSizes,
  seed,
  watchPage,
} from '../support/helpers';

// The shell around the features: the first screen, the example picker, the guided and advanced modes,
// the journey and the help under each stage, in every theme and at the width of a desktop and a phone.
// It runs on the rules-mode server, so nothing here needs a model.

const STATEMENT =
  'Swarm explores scenarios. It does not guarantee or precisely predict real-world behavior.';
const THEMES = ['light', 'dark', 'high-contrast'] as const;
const SIZES = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
] as const;

const question = (page: Page): Locator => page.getByLabel('Your what-if question');
const picker = (page: Page): Locator =>
  page.getByRole('region', { name: 'Not sure what to ask? Try an example' });
const mode = (page: Page, name: 'Guided' | 'Advanced'): Locator =>
  page.getByRole('group', { name: 'Interface mode' }).getByRole('button', { name });

async function inTheme(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.addInitScript((value) => window.localStorage.setItem('swarm.theme', value), theme);
}

test.describe('the first screen', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('says in one line what Swarm answers, what it is not, and the path it takes', async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.goto('/');
    const headings = page.getByRole('heading', { level: 1 });
    await expect(headings).toHaveCount(1);
    await expect(headings).toHaveText('What could happen if…?');

    const statement = page.getByText(STATEMENT, { exact: true });
    await expect(statement).toBeVisible();
    await expect(statement).toBeInViewport({ ratio: 1 });

    const path = page.getByRole('list', { name: 'How Swarm works' }).getByRole('listitem');
    await expect(path).toHaveText([
      /Evidence/u,
      /Scenario/u,
      /Stakeholders/u,
      /Actors/u,
      /Interactions/u,
      /Alternative outcomes/u,
      /Analysis/u,
      /Decision/u,
    ]);

    // The primary action is on the first screen: a person can start asking at once.
    await expect(question(page)).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: 'Build Graph', exact: true })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('keeps the evidence, the run settings and the recorded demonstration reachable below', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('input[type=file]')).toHaveCount(1);
    await expect(page.getByRole('spinbutton', { name: 'Fictional proxies' })).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: 'Rounds / platform' })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Local rules/u })).toBeChecked();
    await expect(page.getByRole('region', { name: 'Demonstration workspace' })).toBeAttached();
  });

  test('says what is missing, in the page, when asked to build from nothing', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Build Graph', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Cannot build this project');
    await expect(question(page)).toHaveAttribute('aria-invalid', 'true');
  });
});

test.describe('the example picker', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('is never empty, and says what an example is and is not', async ({ page }) => {
    await page.goto('/');
    await expect(picker(page)).toBeVisible();
    expect(await picker(page).getByRole('listitem').count()).toBeGreaterThanOrEqual(1);
    await expect(picker(page)).toContainText('Swarm builds the scenario');
    await expect(picker(page).getByRole('button').first()).toBeEnabled();
  });

  test('fills the question and the evidence, and puts focus where the person goes next', async ({
    page,
  }) => {
    await page.goto('/');
    await picker(page).getByRole('button').first().click();
    await expect(question(page)).toBeFocused();
    expect((await question(page).inputValue()).length).toBeGreaterThanOrEqual(10);
    await expect(page.getByText(/[1-9]\d*\/5 FILES/u)).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: /Example loaded|Fictional starter INPUT/u }),
    ).toBeVisible();
    // Nothing is sent by choosing: the person still decides.
    await expect(page.getByRole('button', { name: 'Build Graph', exact: true })).toBeEnabled();
  });

  test('works from the keyboard alone, with a visible focus on every stop', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const seen: string[] = [];
    let reached = false;
    for (let press = 0; press < 40 && !reached; press += 1) {
      await page.keyboard.press('Tab');
      const stop = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement;
        const style = getComputedStyle(element);
        return {
          id: element.id,
          label: (element.getAttribute('aria-label') ?? element.textContent ?? '')
            .trim()
            .slice(0, 30),
          outline: `${style.outlineStyle} ${style.outlineWidth}`,
        };
      });
      seen.push(`${stop.label || stop.id}: ${stop.outline}`);
      expect(
        Number.parseFloat(stop.outline.split(' ')[1] ?? '0'),
        seen.join('\n'),
      ).toBeGreaterThanOrEqual(2);
      reached = stop.id === 'project-question';
    }
    expect(
      reached,
      `the question is a tab stop near the top of the page:\n${seen.join('\n')}`,
    ).toBe(true);
    expect(seen.length, 'the question is within the first dozen stops').toBeLessThanOrEqual(14);

    await page.keyboard.type('What could happen if the opening hours change?');
    await expect(question(page)).toHaveValue('What could happen if the opening hours change?');

    // The next stop is an example, which can be chosen with Enter.
    await page.keyboard.press('Tab');
    await expect(picker(page).getByRole('button').first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(question(page)).toBeFocused();
    expect((await question(page).inputValue()).length).toBeGreaterThanOrEqual(10);
  });
});

test.describe('guided and advanced', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const readiness = (page: Page): Locator => page.locator('details.readiness');

  test('starts Guided, makes Advanced reachable, and keeps the choice', async ({ page }) => {
    await page.goto('/');
    await expect(mode(page, 'Guided')).toHaveAttribute('aria-pressed', 'true');
    await expect(mode(page, 'Advanced')).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => localStorage.getItem('swarm.mode'))).toBeNull();
    await expect(readiness(page)).not.toHaveAttribute('open', '');

    await mode(page, 'Advanced').click();
    await expect(mode(page, 'Advanced')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => localStorage.getItem('swarm.mode'))).toBe('advanced');
    await expect(readiness(page)).toHaveAttribute('open', '');
    await expect(readiness(page).getByText('Model provider', { exact: true })).toBeVisible();

    await page.reload();
    await expect(mode(page, 'Advanced')).toHaveAttribute('aria-pressed', 'true');
    await expect(readiness(page)).toHaveAttribute('open', '');

    await mode(page, 'Guided').click();
    expect(await page.evaluate(() => localStorage.getItem('swarm.mode'))).toBe('guided');
    await expect(readiness(page)).not.toHaveAttribute('open', '');
  });

  test('never loses the page to a value it does not know', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('swarm.mode', 'expert'));
    await page.goto('/');
    await expect(mode(page, 'Guided')).toHaveAttribute('aria-pressed', 'true');
  });

  test('is operable from the keyboard', async ({ page }) => {
    await page.goto('/');
    await mode(page, 'Advanced').focus();
    await page.keyboard.press('Enter');
    await expect(mode(page, 'Advanced')).toHaveAttribute('aria-pressed', 'true');
    await mode(page, 'Guided').focus();
    await page.keyboard.press('Space');
    await expect(mode(page, 'Guided')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('the workspace', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const ids = {} as Record<'environment' | 'report', string>;

  test.beforeAll(async ({ playwright }) => {
    const api = await apiContext(playwright);
    ids.environment = await seed(api, 'environment', { name: 'Shell: environment stage' });
    ids.report = await seed(api, 'report', { name: 'Shell: report stage' });
  });

  test('keeps the five stage names and says in plain words what each is for', async ({ page }) => {
    const problems = watchPage(page);
    await page.goto(`/?project=${ids.environment}`);
    const steps = page
      .getByRole('navigation', { name: 'Guided workflow steps' })
      .getByRole('button');
    await expect(steps).toHaveCount(5);
    const stages = [
      ['Graph Build', 'Understand the evidence'],
      ['Env Setup', 'Review stakeholders and actors'],
      ['Simulation', 'Run and compare scenarios'],
      ['Report', 'Decision brief'],
      ['Interaction', 'Ask questions'],
    ] as const;
    for (const [index, [name, help]] of stages.entries()) {
      await expect(steps.nth(index)).toHaveAccessibleName(new RegExp(`^${name}`, 'u'));
      await expect(steps.nth(index)).toContainText(help);
    }
    await expect(page.getByRole('region', { name: 'Env Setup workbench' })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('shows where the person is on the twelve-step path, and not as navigation', async ({
    page,
  }) => {
    await page.goto(`/?project=${ids.environment}`);
    const path = page.getByRole('group', { name: 'Your path through the scenario' });
    await expect(path.getByRole('listitem')).toHaveText([
      /Question/u,
      /Evidence/u,
      /Stakeholders/u,
      /Actors/u,
      /Scenarios/u,
      /Run/u,
      /Progress/u,
      /Results/u,
      /Explore/u,
      /Change/u,
      /Compare/u,
      /Export/u,
    ]);
    await expect(path.locator('[aria-current="step"]')).toHaveCount(1);
    await expect(path).toContainText('STEP 4 OF 12');
    await expect(path.getByRole('button')).toHaveCount(0);
    // Nothing in the path is claimed that the project's own record does not show.
    await expect(path.locator('.journey-step.done')).toHaveCount(5);
  });

  test('puts the help away in Advanced, and keeps every stage reachable', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('swarm.mode', 'advanced'));
    await page.goto(`/?project=${ids.environment}`);
    await expect(page.locator('.step-help')).toHaveCount(0);
    await expect(
      page.getByRole('navigation', { name: 'Guided workflow steps' }).getByRole('button'),
    ).toHaveCount(5);
    await expect(page.locator('details.project-metadata')).toHaveAttribute('open', '');
    await expect(page.getByRole('button', { name: /^Collapse log/u })).toBeVisible();
  });

  test('keeps the project tools as buttons, grouped, and the report stage open for features', async ({
    page,
  }) => {
    await page.goto(`/?project=${ids.report}`);
    const tools = page.getByRole('group', { name: 'Project tools' });
    for (const name of ['Audit log', 'Duplicate as guided', 'Export JSON']) {
      await expect(tools.getByRole('button', { name })).toBeVisible();
    }
    // Where a decision brief and its critics are mounted, with the existing report under its heading.
    const stack = page.locator('.seam-stack');
    await expect(stack).toHaveCount(1);
    const filled = await stack.evaluate((element) => element.childElementCount > 0);
    await expect(page.getByRole('heading', { name: 'Detailed report' })).toBeVisible({
      visible: filled,
    });
    await expect(page.getByRole('region', { name: 'Report workbench' })).toBeVisible();
  });
});

for (const size of SIZES) {
  test.describe(`${size.name} (${size.width}px)`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const theme of THEMES) {
      test(`the first screen is clean in the ${theme} theme`, async ({ page }) => {
        const problems = watchPage(page);
        await inTheme(page, theme);
        await page.goto('/');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expectNoAxeViolations(page, `${theme} ${size.name}: landing`);
        if (theme !== 'light') await expectNoBrowserPaintedControls(page, `${theme}: landing`);
        await expectNoHorizontalOverflow(page);
        await expectReadableText(page, `landing ${theme} ${size.name}`);
        await expectTargetSizes(page, `landing ${theme} ${size.name}`);

        // The states a person actually sees: asked to build from nothing, then filled in from an
        // example with the details open.
        await page.getByRole('button', { name: 'Build Graph', exact: true }).click();
        await expect(page.getByRole('alert')).toContainText('Cannot build this project');
        await expectNoAxeViolations(page, `${theme} ${size.name}: landing, validation error`);
        await picker(page).getByRole('button').first().click();
        await mode(page, 'Advanced').click();
        await expectNoAxeViolations(page, `${theme} ${size.name}: landing filled, Advanced`);
        await expectNoHorizontalOverflow(page);
        expect(problems).toEqual([]);
      });

      test(`a project's workspace is clean in the ${theme} theme`, async ({ page, playwright }) => {
        const api = await apiContext(playwright);
        const id = await seed(api, 'simulation', { name: `Shell: ${theme} ${size.name}` });
        await inTheme(page, theme);
        await page.goto(`/?project=${id}`);
        await expect(
          page.getByRole('group', { name: 'Your path through the scenario' }),
        ).toBeVisible();
        await expect(page.getByRole('button', { name: /Generate Report/u })).toBeVisible();
        await expectNoAxeViolations(page, `${theme} ${size.name}: simulation stage`);
        if (theme !== 'light') await expectNoBrowserPaintedControls(page, `${theme}: workspace`);
        await expectNoHorizontalOverflow(page);
        await expectReadableText(page, `workspace ${theme} ${size.name}`);
        await expectTargetSizes(page, `workspace ${theme} ${size.name}`);
      });
    }
  });
}

test.describe('reduced motion', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  const motion = (page: Page) =>
    page.evaluate(() => {
      const card = document.querySelector('.example-card') as HTMLElement;
      const button = document.querySelector('.example-card .button') as HTMLElement;
      return {
        reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
        cardTransition: getComputedStyle(card).transitionProperty,
        cardDuration: getComputedStyle(card).transitionDuration,
        buttonDuration: getComputedStyle(button).transitionDuration,
      };
    });
  const cardTransform = (page: Page) =>
    page
      .locator('.example-card')
      .first()
      .evaluate((card) => getComputedStyle(card).transform);

  test('stops every transition and keeps a card where it is when asked for less motion', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(picker(page)).toBeVisible();
    const state = await motion(page);
    expect(state.reduce).toBe(true);
    expect(state.cardTransition).toBe('none');
    expect(state.cardDuration).toBe('0s');
    expect(state.buttonDuration).toBe('0s');

    await picker(page).getByRole('listitem').first().hover();
    await page.waitForTimeout(300);
    expect(await cardTransform(page)).toBe('none');
  });

  test('moves a card by a pixel, briefly, when motion is welcome', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    const state = await motion(page);
    expect(state.reduce).toBe(false);
    expect(state.cardTransition).toContain('transform');
    expect(Number.parseFloat(state.cardDuration)).toBeGreaterThan(0);
    expect(Number.parseFloat(state.cardDuration)).toBeLessThanOrEqual(0.3);

    await picker(page).getByRole('listitem').first().hover();
    await expect.poll(() => cardTransform(page)).not.toBe('none');
  });

  test('draws no keyframe animation on its own on the first screen', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('.spin:visible')).toHaveCount(0);
    // A transition answers a change of state, such as the button being enabled once the server has
    // answered; a keyframe animation would run by itself.
    const running = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((animation) => animation instanceof CSSAnimation)
        .filter((animation) => animation.playState === 'running')
        .map((animation) => (animation as CSSAnimation).animationName),
    );
    expect(running).toEqual([]);
  });
});
