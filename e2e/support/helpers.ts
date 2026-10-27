import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type PlaywrightWorkerArgs,
} from '@playwright/test';

export const viewports = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '390x844', width: 390, height: 844 },
] as const;

export const SOURCE = [
  'This is a fictional scenario for testing a proposed change to public library opening hours.',
  'The Library Service proposes opening until nine in the evening on weekdays and closing earlier on Sundays.',
  'Residents who work late support longer evening hours, while some neighbours worry about noise and staffing costs.',
  'The Local Council asks for usage evidence before approving any extra budget for the library.',
  'No survey has measured support. These notes describe proposed actions, not observed outcomes.',
].join('\n');

export type Step = 'knowledge' | 'environment' | 'simulation' | 'report';

interface ProjectView {
  id: string;
  status: string;
  currentRound: number;
  rounds: unknown[];
  parentId: string | null;
  execution: { modelCalls: number; inputTokens: number; outputTokens: number } | null;
  console: { steps: Record<string, string> } | null;
}

export function apiContext(
  playwright: PlaywrightWorkerArgs['playwright'],
): Promise<APIRequestContext> {
  return playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
}

export async function getProject(request: APIRequestContext, id: string): Promise<ProjectView> {
  const response = await request.get(`/api/projects/${id}`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as ProjectView;
}

export async function listProjects(
  request: APIRequestContext,
): Promise<{ id: string; name: string; parentId: string | null }[]> {
  const body = (await (await request.get('/api/projects')).json()) as {
    projects: { id: string; name: string; parentId: string | null }[];
  };
  return body.projects;
}

export async function createGuided(
  request: APIRequestContext,
  options: { name?: string; rounds?: number; agents?: number; mode?: 'local' | 'llm' } = {},
): Promise<string> {
  const response = await request.post('/api/projects', {
    data: {
      name: options.name ?? 'E2E library hours scenario',
      question:
        'How might fictional community groups respond to a proposed change in library opening hours?',
      workflow: 'guided',
      documents: [{ name: 'library-notes.md', content: SOURCE }],
      settings: {
        mode: options.mode ?? 'local',
        agentCount: options.agents ?? 6,
        rounds: options.rounds ?? 4,
        seed: 42,
        network: 'community',
      },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

/** Starts one guided stage over HTTP and waits until it is persisted as ready. */
export async function advance(
  request: APIRequestContext,
  id: string,
  step: Step,
  resume = false,
): Promise<void> {
  const response = await request.post(
    `/api/projects/${id}/steps/${step}`,
    resume ? { data: { resume: true } } : {},
  );
  expect(response.status(), await response.text()).toBe(202);
  await expect
    .poll(async () => (await getProject(request, id)).console?.steps[step], {
      timeout: 90_000,
      intervals: [100, 250, 500],
    })
    .toBe('ready');
}

export async function seed(
  request: APIRequestContext,
  upTo: Step | 'draft',
  options: Parameters<typeof createGuided>[1] = {},
): Promise<string> {
  const id = await createGuided(request, options);
  for (const step of ['knowledge', 'environment', 'simulation', 'report'] as const) {
    if (upTo === 'draft') break;
    await advance(request, id, step);
    if (step === upTo) break;
  }
  return id;
}

/** Every serious, moderate or minor axe finding fails: the audited surfaces are expected to be clean. */
export async function expectNoAxeViolations(page: Page, label: string): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.map(
      (violation) =>
        `${violation.impact}: ${violation.id} ×${violation.nodes.length} (${violation.nodes[0]?.target.join(' ')})`,
    ),
    `axe violations: ${label}`,
  ).toEqual([]);
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, 'document must not scroll horizontally').toBeLessThanOrEqual(
    overflow.clientWidth + 1,
  );
}

/** Visible HTML text must be at least 11 CSS px; SVG text is measured by its rendered scale instead. */
export async function expectReadableText(page: Page, label: string): Promise<void> {
  const tiny = await page.evaluate(() => {
    const found: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const element = node.parentElement;
      if (!element || !node.textContent?.trim()) continue;
      if (element.closest('svg, script, style, noscript, [hidden], .sr-only')) continue;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      if (style.visibility === 'hidden' || style.display === 'none' || !box.width || !box.height)
        continue;
      const size = Number.parseFloat(style.fontSize);
      if (size < 11)
        found.push(
          `${element.tagName.toLowerCase()}.${element.className} ${size}px "${node.textContent.trim().slice(0, 28)}"`,
        );
    }
    return found;
  });
  expect(tiny, `text under 11px: ${label}`).toEqual([]);
}

/** SVG text is scaled by its viewBox; the rendered size is the computed size times the CTM scale. */
export async function renderedSvgTextPx(page: Page, scope: string): Promise<number[]> {
  return page.evaluate((selector) => {
    return [...document.querySelectorAll(`${selector} text`)]
      .filter((text) => text.getClientRects().length > 0)
      .map((text) => {
        const scale = (text as SVGGraphicsElement).getScreenCTM()?.a ?? 1;
        return Number.parseFloat(getComputedStyle(text).fontSize) * scale;
      });
  }, scope);
}

/** Pointer targets must be at least 24x24 CSS px (WCAG 2.2 AA 2.5.8); visually hidden inputs are exempt. */
export async function expectTargetSizes(page: Page, label: string): Promise<void> {
  const small = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        'button, input:not([type=hidden]), select, textarea, summary, [role=tab], [role=button]',
      ),
    ]
      .filter((element) => !element.closest('svg, .sr-only, [hidden]'))
      .map((element) => ({ element, box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && box.height > 0 && (box.width < 24 || box.height < 24))
      .map(
        ({ element, box }) =>
          `${element.tagName.toLowerCase()}.${element.className} ${Math.round(box.width)}x${Math.round(box.height)} "${(element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 28)}"`,
      ),
  );
  expect(small, `targets under 24px: ${label}`).toEqual([]);
}
