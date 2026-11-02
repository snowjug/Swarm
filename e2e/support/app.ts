import { expect, type Locator, type Page } from '@playwright/test';

// How a test finds its way around the application shell: the six scenes of the journey, the address that names them,
// and the places every scene shares. Anything that belongs to one scene lives in a helper file of its own.

export const SCENES = ['ask', 'ground', 'map', 'simulate', 'compare', 'decide'] as const;
export type SceneName = (typeof SCENES)[number];

export const SCENE_LABEL: Record<SceneName, string> = {
  ask: 'Ask',
  ground: 'Ground',
  map: 'Map',
  simulate: 'Simulate',
  compare: 'Compare',
  decide: 'Decide',
};

export type ThemeName = 'light' | 'dark' | 'high-contrast';

export interface OpenOptions {
  project?: string;
  scene?: SceneName;
  view?: string;
  /** Chosen before the page loads, the way the person's own choice would be. */
  theme?: ThemeName;
}

/** The address of a project, a scene of it and a view inside the scene. */
export function addressOf(options: Pick<OpenOptions, 'project' | 'scene' | 'view'> = {}): string {
  const query = new URLSearchParams();
  if (options.project) query.set('project', options.project);
  if (options.scene && options.scene !== 'ask') query.set('scene', options.scene);
  if (options.view) query.set('view', options.view);
  const text = query.toString();
  return text ? `/?${text}` : '/';
}

/** Nothing on the page is still loading: no skeleton, no busy region. */
export async function settled(page: Page): Promise<void> {
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.locator('[aria-busy="true"], .sw-skeleton')).toHaveCount(0, {
    timeout: 30_000,
  });
}

/** Opens the application at a project and scene, and waits until the scene has finished loading. */
export async function openApp(page: Page, options: OpenOptions = {}): Promise<void> {
  if (options.theme) {
    const theme = options.theme;
    await page.addInitScript((value) => window.localStorage.setItem('swarm.theme', value), theme);
  }
  await page.goto(addressOf(options));
  await settled(page);
}

/** The journey, wherever it is drawn: in the top bar on a wide screen and in the dock on a phone. */
export const journey = (page: Page): Locator =>
  page.getByRole('navigation', { name: 'Journey' }).locator('visible=true').first();

/** One step of the journey by its name (a locked one is named "Compare, locked: …"). */
export const step = (page: Page, scene: SceneName): Locator =>
  journey(page).getByRole('button', { name: new RegExp(`^${SCENE_LABEL[scene]}(?:,|$)`, 'u') });

/** Goes to a scene by the journey, as a person would. */
export async function goTo(page: Page, scene: SceneName): Promise<void> {
  await step(page, scene).click();
  await expectScene(page, scene);
}

/**
 * The scene shown is the one the journey marks as current, and the address says so. The first screen, before
 * there is a project, has no journey: it is the question itself.
 */
export async function expectScene(page: Page, scene: SceneName): Promise<void> {
  const hasJourney = (await journey(page).count()) > 0;
  if (scene === 'ask' && !hasJourney) {
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Explore what could happen next.',
    );
  } else {
    await expect(step(page, scene)).toHaveAttribute('aria-current', 'step');
  }
  if (scene === 'ask') await expect(page).not.toHaveURL(/[?&]scene=/u);
  else await expect(page).toHaveURL(new RegExp(`[?&]scene=${scene}(?:&|$)`, 'u'));
  await settled(page);
}

/** A step the journey has not opened yet says so in its name and cannot be entered. */
export async function expectLocked(page: Page, scene: SceneName): Promise<void> {
  await expect(step(page, scene)).toHaveAttribute('aria-disabled', 'true');
  await expect(step(page, scene)).toHaveAccessibleName(/locked/u);
}

/** The id the address holds for the open project. */
export function projectOf(page: Page): string {
  const id = new URL(page.url()).searchParams.get('project');
  if (!id) throw new Error(`No project in ${page.url()}`);
  return id;
}

/** Where the application says what it did (its toasts). */
export const notices = (page: Page): Locator => page.getByRole('region', { name: 'Notifications' });
