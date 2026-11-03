import { expect, type Locator, type Page, type Response } from '@playwright/test';
import { EXAMPLE_SCENARIOS, type ExampleScenario } from '../../shared/example-scenarios';
import type { ScenarioView } from '../../shared/scenario';
import { openApp, projectOf, settled, type OpenOptions } from './app';
import { getJson } from './lab-api';

// How a test drives the first scene, Ask: the question, its evidence, the scenario that is read from it and the
// press that makes the project. Everything is found the way a person finds it, by role and name.

export const QUESTION_NAME = 'Your what-if question';
export const HEADING = 'See how a decision could unfold.';
export const SUPPORT_LINE =
  'Swarm researches the context, maps who matters, simulates reactions, and shows possible paths forward.';
export const TAGLINE = 'Explore scenarios, not predictions.';
export const POSITIONING =
  'Swarm explores scenarios. It does not guarantee or precisely predict real-world behavior.';

/** The only things the page may ask of the server before the person has asked for anything. */
export const READS_AT_OPEN = [
  'GET /api/config',
  'GET /api/projects',
  'GET /api/provider/status',
] as const;

/** The questions the empty box suggests in turn (frontend/src/scenes/ask/templates.ts). */
export const PROMPTS = [
  'What if our city replaces a bus route with an on-demand shuttle?',
  'What if we raise our subscription price and drop the free trial?',
  'What if our team moves customer support to an AI-first model?',
  'What if a clinic moves routine check-ups to video visits?',
  'What if we open a second site in a new region?',
  'What if a school district shortens the school week?',
] as const;

/** A question that is long enough to read, and that no example knows. */
export const HARBOUR_QUESTION =
  'What could happen if the harbour office doubles the mooring fee for visiting boats?';
export const HARBOUR_NOTES = {
  name: 'harbour-notes.md',
  content: `Illustrative synthetic notes written for a test; no real harbour is described.

The harbour office is considering a higher mooring fee for visiting boats. Visiting skippers say the fee is already more than the marina next door asks, and the harbour master worries about empty berths in the shoulder season. Local sailing clubs ask for a discount for members, and the town council wants to know what the fee brings in.`,
};

/** The fictional starter that sits beside the examples: a made-up question with its own notes. */
export const STARTER = {
  title: 'Fictional library hours',
  chip: 'Library hours',
  question:
    'How might fictional community groups respond to a proposed change in library opening hours?',
  document: 'fictional-library-input.md',
  summary: '1 document · invented for learning',
} as const;

const CHIPS: Record<string, string> = {
  'copilot-in-teams': 'Copilot in Teams',
  'regional-price-change': 'Cloud price change',
  'ecommerce-experience': 'Online store checkout',
  'ai-first-support': 'AI-first support',
  'launch-pricing': 'Launch pricing',
};

/** What an example is called on its chip: a short name, or its title when it has none. */
export const chipName = (example: ExampleScenario): string => CHIPS[example.id] ?? example.title;

/** "5 documents · sample evidence": what the note under the composer says an example brought. */
export const exampleSummary = (example: ExampleScenario): string => {
  const count = example.documents.length;
  return `${count} ${count === 1 ? 'document' : 'documents'} · sample evidence`;
};

export const EXAMPLES = EXAMPLE_SCENARIOS;

export const escapeRegExp = (text: string): RegExp['source'] =>
  text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

// ---------------------------------------------------------------------------------------------
// The first screen
// ---------------------------------------------------------------------------------------------

/** Opens the first screen, before there is a project, and waits until it has said what it is for. */
export async function openAsk(page: Page, options: Pick<OpenOptions, 'theme'> = {}): Promise<void> {
  await openApp(page, options);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADING);
}

export const questionBox = (page: Page): Locator =>
  page.getByRole('textbox', { name: QUESTION_NAME });
export const exploreButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Explore', exact: true });
export const optionsButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Options', exact: true });
/** The website or domain field, which is for automatic research: it is out of reach where research is not on. */
export const siteBox = (page: Page): Locator =>
  page.getByRole('textbox', { name: /^Website or domain/u });
/** The switch for automatic research, and the line under it that says what it does or why it is not available. */
export const researchSwitch = (page: Page): Locator =>
  page.getByRole('switch', { name: /^Research automatically/u });
/** The advanced fields (the place, the guidance for research, what is assumed) open under this button. */
export const advancedButton = (page: Page): Locator =>
  page.getByRole('button', { name: /^Advanced\b/u });
export const assumptionsButton = (page: Page): Locator =>
  page.getByRole('button', { name: /^Assumptions\b/u });

/** Opens the advanced fields, if they are not open. */
export async function openAdvanced(page: Page): Promise<void> {
  if ((await advancedButton(page).getAttribute('aria-expanded')) !== 'true') {
    await advancedButton(page).click();
  }
  await expect(advancedButton(page)).toHaveAttribute('aria-expanded', 'true');
}

/** How far ahead the effects are judged: a row of choices on a wide screen, a list on a phone. */
export async function chooseHorizon(page: Page, label: string): Promise<void> {
  const list = page.getByRole('combobox', { name: 'Time horizon' });
  if (await list.count()) await list.selectOption({ label });
  else await page.getByRole('radio', { name: label, exact: true }).click();
}

/** The time horizon that is chosen, whichever way it is drawn. */
export async function expectHorizon(page: Page, label: string): Promise<void> {
  const list = page.getByRole('combobox', { name: 'Time horizon' });
  if (await list.count()) await expect(list.locator('option:checked')).toHaveText(label);
  else await expect(page.getByRole('radio', { name: label, exact: true })).toBeChecked();
}
/** The button that opens the evidence menu: on the first screen it says how many sources are attached. */
export const evidenceButton = (page: Page): Locator =>
  page.getByRole('button', { name: /^Evidence\b|^Add evidence$/u });

/** The evidence button names itself from what it shows: "Evidence", and, once something is attached, "Evidence 3 attached". */
export const expectAttached = (page: Page, count: number): Promise<void> =>
  expect(evidenceButton(page)).toHaveAccessibleName(
    count === 0
      ? /^Evidence(?:,? 0 attached)?$/u
      : new RegExp(`^Evidence,? ${count} attached$`, 'u'),
  );
/** The templates under the composer: sentences with blanks, and "Custom". */
export const templatesList = (page: Page): Locator =>
  page.getByRole('list', { name: 'Start from a template' });
export const tray = (page: Page): Locator => page.getByRole('list', { name: 'Attached evidence' });
/** What the first screen says went wrong with the question or the evidence: a notice in the page, not a toast. */
export const asked = (page: Page): Locator =>
  page.getByRole('main').getByRole('status').or(page.getByRole('main').getByRole('alert'));

/** The one way into a demonstration: it is named for what it holds, a recorded demonstration or the sample cases. */
const DEMONSTRATION = /^Try a (?:recorded demonstration|sample case)$/u;
export const demonstrationLink = (page: Page): Locator =>
  page.getByRole('button', { name: DEMONSTRATION });
export const demonstrationDialog = (page: Page): Locator =>
  page.getByRole('dialog', { name: DEMONSTRATION });

/** Opens the list of sample cases (it may be open already). */
export async function openSamples(page: Page): Promise<Locator> {
  const dialog = demonstrationDialog(page);
  if (!(await dialog.isVisible())) await demonstrationLink(page).click();
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Picks a sample case and waits until its question and every document are in the composer, and have arrived. */
export async function chooseExample(page: Page, example: ExampleScenario): Promise<void> {
  const dialog = await openSamples(page);
  await dialog.getByRole('button', { name: chipName(example), exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(questionBox(page)).toHaveValue(example.question);
  await expect(tray(page).getByRole('listitem')).toHaveCount(example.documents.length);
  // A source arrives from a little smaller than it is: it is measured, and pressed, once it has.
  await stays(tray(page).getByRole('button').first());
}

export async function chooseStarter(page: Page): Promise<void> {
  const dialog = await openSamples(page);
  await dialog.getByRole('button', { name: STARTER.chip, exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(questionBox(page)).toHaveValue(STARTER.question);
  await expect(tray(page).getByRole('listitem')).toHaveCount(1);
  await stays(tray(page).getByRole('button').first());
}

// ---------------------------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------------------------

export type Way = 'Files' | 'Paste' | 'Web page';

export const evidenceDialog = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'Add evidence' });

/** Opens the evidence menu (it may be open already) on one of its three ways of adding. */
export async function openEvidence(page: Page, way?: Way): Promise<Locator> {
  const dialog = evidenceDialog(page);
  if (!(await dialog.isVisible())) await evidenceButton(page).click();
  await expect(dialog).toBeVisible();
  if (way) {
    await dialog.getByRole('radio', { name: way, exact: true }).click();
    await expect(dialog.getByRole('radio', { name: way, exact: true })).toBeChecked();
  }
  return dialog;
}

export async function closeEvidence(page: Page): Promise<void> {
  await evidenceDialog(page).getByRole('button', { name: 'Done' }).click();
  await expect(evidenceDialog(page)).toBeHidden();
}

/** Pastes a source: its name, its text, and the press that attaches it. */
export async function pasteSource(
  page: Page,
  name: string,
  content: string,
  options: { keepOpen?: boolean } = {},
): Promise<void> {
  const dialog = await openEvidence(page, 'Paste');
  await dialog.getByRole('textbox', { name: 'Source filename' }).fill(name);
  const text = dialog.getByRole('textbox', { name: 'Source text, not your question' });
  await text.fill(content);
  await dialog.getByRole('button', { name: 'Attach', exact: true }).click();
  // What was attached is taken out of the field (what was refused is left in it). The tray is looked at once the menu
  // is closed: on a phone the menu is a sheet, and the page behind a sheet is out of reach.
  await expect(text).toHaveValue('');
  if (options.keepOpen) return;
  await closeEvidence(page);
  await expect(
    tray(page).getByRole('button', { name: new RegExp(`^Read ${escapeRegExp(name)},`, 'u') }),
  ).toBeVisible();
}

export interface UploadedFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** Chooses files in the evidence menu, as the file dialog would give them. */
export async function uploadFiles(page: Page, files: UploadedFile[]): Promise<Locator> {
  const dialog = await openEvidence(page, 'Files');
  await dialog.getByLabel('Choose evidence files').setInputFiles(files);
  return dialog;
}

/** Files in the hand of a person who is dragging them from a folder: what the page sees of them while they are over it. */
export const draggedFiles = (page: Page, files: UploadedFile[]) =>
  page.evaluateHandle(
    (items) => {
      const data = new DataTransfer();
      for (const item of items) {
        data.items.add(new File([new Uint8Array(item.bytes)], item.name, { type: item.type }));
      }
      return data;
    },
    files.map((file) => ({ name: file.name, type: file.mimeType, bytes: [...file.buffer] })),
  );

/** Drops files on a target the way a person drags them from a folder, with the events a browser sends. */
export async function dropFiles(page: Page, target: Locator, files: UploadedFile[]): Promise<void> {
  const transfer = await draggedFiles(page, files);
  await target.dispatchEvent('dragover', { dataTransfer: transfer });
  await target.dispatchEvent('drop', { dataTransfer: transfer });
}

/** The pill of an attached source, which opens it to be read, and the control that takes it away. */
export const pill = (page: Page, name: string): Locator =>
  tray(page).getByRole('button', { name: new RegExp(`^Read ${escapeRegExp(name)}, `, 'u') });
export const removeSource = (page: Page, name: string): Locator =>
  tray(page).getByRole('button', { name: `Remove ${name}`, exact: true });

/** The text file a person would choose from a folder. */
export const textFile = (name: string, content: string): UploadedFile => ({
  name,
  mimeType: 'text/plain',
  buffer: Buffer.from(content, 'utf8'),
});

/** What the menu says went wrong with the files, or with a page. */
export const menuProblem = (page: Page): Locator => evidenceDialog(page).getByRole('alert');

/** Asks the server for a public page by the address field of the evidence menu, and returns its answer. */
export async function fetchPage(page: Page, address: string): Promise<Response> {
  const dialog = await openEvidence(page, 'Web page');
  await dialog.getByRole('textbox', { name: 'Web address' }).fill(address);
  const answered = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/evidence/url',
  );
  await dialog.getByRole('button', { name: 'Fetch', exact: true }).click();
  return answered;
}

/** What the preview of a fetched page is called. */
export const fetchedPreview = (page: Page): Locator =>
  evidenceDialog(page).getByRole('article', { name: 'The fetched page' });

/** Fetches a page and attaches it as evidence. */
export async function addPage(page: Page, address: string): Promise<{ name: string; url: string }> {
  const answer = await fetchPage(page, address);
  expect(answer.status(), `fetching ${address}`).toBe(200);
  const body = (await answer.json()) as {
    document: { name: string; provenance: { url?: string } };
  };
  const dialog = evidenceDialog(page);
  await expect(fetchedPreview(page)).toBeVisible();
  await dialog.getByRole('button', { name: 'Add as evidence' }).click();
  // Once it is a source its preview is gone; the tray is looked at when the menu is closed (a sheet, on a phone).
  await expect(fetchedPreview(page)).toHaveCount(0);
  await closeEvidence(page);
  await expect(
    tray(page).getByRole('button', {
      name: new RegExp(`^Read ${escapeRegExp(body.document.name)},`, 'u'),
    }),
  ).toBeVisible();
  return { name: body.document.name, url: body.document.provenance.url ?? address };
}

// ---------------------------------------------------------------------------------------------
// The scenario that is read
// ---------------------------------------------------------------------------------------------

export const reviewHeading = (page: Page): Locator =>
  page.getByRole('heading', { level: 1, name: 'Your scenario' });
export const goOn = (page: Page): Locator =>
  page.getByRole('button', { name: 'Ground it', exact: true });
/** The bar at the foot of the scenario: the way back, what is missing or that nothing runs yet, and the way on. */
export const bar = (page: Page): Locator => page.getByRole('group', { name: 'Continue' });

/** Presses Explore and waits for the scenario that was read from the question, whole and on its own. */
export async function readScenario(page: Page): Promise<void> {
  await exploreButton(page).click();
  await expect(reviewHeading(page)).toBeVisible();
  // The page changes its heading before it changes what is under it: the composer leaves, then the scenario arrives.
  await expect(goOn(page)).toBeVisible();
  await expect(questionBox(page)).toHaveCount(0);
  await stays(goOn(page));
}

/** Waits until a control has stopped moving: a page that is fading in is not yet where it will be. */
export async function stays(control: Locator): Promise<void> {
  let last = '';
  let steady = 0;
  await expect
    .poll(
      async () => {
        const box = JSON.stringify(await control.boundingBox());
        steady = box === last ? steady + 1 : 0;
        last = box;
        return steady;
      },
      { intervals: [100], timeout: 10_000 },
    )
    .toBeGreaterThanOrEqual(3);
}

/** How many there are once the number has stopped changing, so that a duplicate that arrives a moment late is counted. */
export async function settledCount(items: Locator): Promise<number> {
  let last = -1;
  let steady = 0;
  await expect
    .poll(
      async () => {
        const now = await items.count();
        steady = now === last ? steady + 1 : 0;
        last = now;
        return steady;
      },
      { intervals: [100], timeout: 10_000 },
    )
    .toBeGreaterThanOrEqual(5);
  return last;
}

/** Every transition and animation that ends has ended: a colour is measured where it will stay, not on its way. */
export async function atRest(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const running = (): Animation[] =>
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
    const frame = (): Promise<void> =>
      new Promise((resolve) => requestAnimationFrame(() => resolve()));
    // An inherited colour reaches each level of nesting that has a transition of its own one frame after the last,
    // so the page is at rest once a couple of frames have passed with nothing left to wait for.
    for (let quiet = 0, rounds = 0; quiet < 2 && rounds < 200; rounds += 1) {
      const pending = running();
      if (pending.length === 0) {
        quiet += 1;
        await frame();
      } else {
        quiet = 0;
        await Promise.all(pending.map((animation) => animation.finished.catch(() => undefined)));
      }
    }
  });
}

/** The screen that says the question is being read, with its way to stop: not the status inside the busy Explore button. */
export const readingView = (page: Page): Locator =>
  page.getByRole('status').filter({ has: page.getByRole('button', { name: 'Stop', exact: true }) });

/** A part of the scenario by the heading it is under ("What changes", "Ways to do it", …). */
export const part = (page: Page, title: string): Locator =>
  page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 3, name: title, exact: true }) });

/** One of the questions the reading asked, found by its words ("Over what period should the effects be judged?"). */
export const question = (page: Page, words: string): Locator =>
  part(page, 'Swarm asks').getByRole('listitem').filter({ hasText: words });

/**
 * The button that edits a piece of text where it stands. It is named by the words that are seen: "label: value. Edit",
 * or, while the text is empty, "hint: label, empty. Edit".
 */
export const editable = (scope: Locator | Page, label: string): Locator => {
  const name = escapeRegExp(label);
  return scope.getByRole('button', {
    name: new RegExp(`^(?:${name}: .*|.*: ${name}, empty)\\. Edit$`, 's'),
  });
};

/** What a piece of editable text holds, read from its button (an empty one says so in its name). */
export async function textOf(scope: Locator | Page, label: string): Promise<string> {
  const name = (await editable(scope, label).getAttribute('aria-label')) ?? '';
  if (new RegExp(`^.*: ${escapeRegExp(label)}, empty\\. Edit$`, 's').test(name)) return '';
  return name.slice(label.length + 2, -'. Edit'.length);
}

/** Edits a piece of text where it stands: opens it, replaces it and keeps the change. */
export async function editText(
  scope: Locator | Page,
  label: string,
  value: string,
  options: { multiline?: boolean } = {},
): Promise<void> {
  await editable(scope, label).click();
  const field = scope.getByRole('textbox', { name: label, exact: true });
  await field.fill(value);
  await field.press(options.multiline ? 'Control+Enter' : 'Enter');
  await expect(field).toHaveCount(0);
}

/** Answers a question the reading asked, by its words, and presses Answer. */
export async function answerQuestion(page: Page, words: string, answer: string): Promise<void> {
  const item = question(page, words);
  await item.getByRole('textbox').fill(answer);
  await item.getByRole('button', { name: 'Answer', exact: true }).click();
}

/** Opens the harbour question with its notes attached and reads it: the scenario is then on the screen. */
export async function reviewHarbour(page: Page): Promise<void> {
  await openAsk(page);
  await questionBox(page).fill(HARBOUR_QUESTION);
  await pasteSource(page, HARBOUR_NOTES.name, HARBOUR_NOTES.content);
  await readScenario(page);
}

/** Whether the keyboard is somewhere inside `scope`, and not back on the page. */
export const focusIsIn = (page: Page, scope = 'main'): Locator => page.locator(`${scope} :focus`);

/**
 * What covers the control that has focus: the bar at the top, or the bar that stays at the foot of the scenario.
 * A control that takes focus must be seen, so the list is empty when it is.
 */
export function coveredByBars(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return ['nothing has focus'];
    const box = element.getBoundingClientRect();
    const name = (element.getAttribute('aria-label') ?? element.textContent ?? '')
      .trim()
      .slice(0, 40);
    const found: string[] = [];
    for (const bar of document.querySelectorAll('header, [role=group][aria-label="Continue"]')) {
      if (bar.contains(element)) continue;
      const rect = bar.getBoundingClientRect();
      const across = Math.min(box.right, rect.right) - Math.max(box.left, rect.left);
      const down = Math.min(box.bottom, rect.bottom) - Math.max(box.top, rect.top);
      if (across > 1 && down > 1) {
        found.push(
          `"${name}" (${Math.round(box.top)}..${Math.round(box.bottom)}px) is under the ${bar.tagName === 'HEADER' ? 'top' : 'bottom'} bar (${Math.round(rect.top)}..${Math.round(rect.bottom)}px)`,
        );
      }
    }
    return found;
  });
}

/** Presses "Ground it" and waits until the project exists and the page has gone to it. */
export async function groundIt(page: Page): Promise<string> {
  await goOn(page).click();
  await expect(page).toHaveURL(/[?&]project=/u);
  await expect(page).toHaveURL(/[?&]scene=ground(?:&|$)/u);
  await settled(page);
  return projectOf(page);
}

/**
 * Nothing is cut off by the edge of the screen. The page itself may not scroll sideways (a shared check says so), but
 * a page that hides its overflow passes that check while a composer, a button or a line of text runs off the screen
 * and cannot be read or pressed. Here every visible element is measured against the width of the screen; a row that
 * scrolls sideways on purpose, and a box that clips well inside the screen (a long name cut with an ellipsis), hold
 * what is in them.
 */
export async function expectNothingClipped(
  page: Page,
  label: string,
  scope = 'main',
): Promise<void> {
  const measure = () =>
    page.evaluate((root) => {
      const width = document.documentElement.clientWidth;
      const found: string[] = [];
      for (const element of document.querySelectorAll(`${root}, ${root} *`)) {
        if (element.closest('svg, canvas, [aria-hidden="true"], .sr-only, [hidden], [inert]'))
          continue;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.position === 'fixed')
          continue;
        const box = element.getBoundingClientRect();
        if (!box.width || !box.height) continue;
        if (box.right <= width + 1 && box.left >= -1) continue;
        let held = false;
        for (
          let parent = element.parentElement;
          parent && parent !== document.body;
          parent = parent.parentElement
        ) {
          const own = getComputedStyle(parent);
          if (own.overflowX === 'auto' || own.overflowX === 'scroll') {
            held = true;
            break;
          }
          if (own.overflowX !== 'visible') {
            const outer = parent.getBoundingClientRect();
            if (outer.right < width - 4 && outer.left > 4) {
              held = true;
              break;
            }
          }
        }
        if (held) continue;
        const name = element.getAttribute('aria-label') ?? element.textContent ?? '';
        found.push(
          `${element.tagName.toLowerCase()} runs from ${Math.round(box.left)}px to ${Math.round(box.right)}px on a ${width}px screen: "${name.trim().slice(0, 40)}"`,
        );
      }
      return found;
    }, scope);
  // A page that is still arriving (fading in, finding its place) is not where it will be: what is cut off is judged
  // when it has settled, and a layout that is wrong stays wrong.
  await expect
    .poll(async () => (await measure()).slice(0, 6), {
      message: `content cut off by the edge of the screen: ${label}`,
      intervals: [100, 250, 500],
      timeout: 5_000,
    })
    .toEqual([]);
}

/** What a focused element is, in words, for the message of an assertion about where focus went. */
export const focusedElement = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return 'nothing (the page)';
    const name = element.getAttribute('aria-label') ?? element.textContent ?? '';
    return `${element.tagName.toLowerCase()} "${name.trim().slice(0, 60)}"`;
  });

/** How many explorations the server holds, for a test that says nothing was made. */
export async function projectCount(page: Page): Promise<number> {
  return (await getJson<{ total: number }>(page, '/api/projects')).total;
}

/** The scenario a project keeps, with the revision it is at. */
export const scenarioOf = (page: Page, project: string): Promise<ScenarioView> =>
  getJson<ScenarioView>(page, `/api/projects/${project}/scenario`);

/** Makes a project over HTTP, the way the page does, and returns its id. For a spec whose subject is not making one. */
export async function createProject(
  page: Page,
  seed: { name?: string; question?: string; documents?: { name: string; content: string }[] } = {},
): Promise<string> {
  const created = await page.request.post('/api/projects', {
    data: {
      name: seed.name ?? 'A project made for a test',
      question: seed.question ?? HARBOUR_QUESTION,
      workflow: 'guided',
      documents: seed.documents ?? [HARBOUR_NOTES],
      settings: { mode: 'local', agentCount: 6, rounds: 4, seed: 42, network: 'community' },
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

// ---------------------------------------------------------------------------------------------
// What the page asks of the network
// ---------------------------------------------------------------------------------------------

export interface Asked {
  method: string;
  url: URL;
}

/** Every request the page makes from now on, to any host, in order. */
export function recordRequests(page: Page): Asked[] {
  const made: Asked[] = [];
  page.on('request', (request) =>
    made.push({ method: request.method(), url: new URL(request.url()) }),
  );
  return made;
}

/** The calls to the application, as "METHOD /path", and nothing else. */
export const apiCalls = (made: readonly Asked[]): string[] =>
  made
    .filter((request) => request.url.pathname.startsWith('/api/'))
    .map((request) => `${request.method} ${request.url.pathname}`);
