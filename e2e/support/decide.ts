import { readFile } from 'node:fs/promises';
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { extractText, getDocumentProxy } from 'unpdf';
import type { BriefView } from '../../shared/brief';
import type { StudioView } from '../../shared/studio';
import { addressOf, openApp } from './app';
import { advance, createGuided } from './helpers';
import { makeProject, type MakeOptions } from './shell';

// What the specs of the Decide scene share: projects at each point of its life (a comparison, a brief with or
// without the independent review, the deep dive's report, an opened studio), the places on the page (the verdict,
// the contents, a chapter, the tools), what a download or a printed page holds, and how a page that is printed
// is judged. Nothing here knows how a chapter is drawn: it finds things the way a person does.

// ---------------------------------------------------------------------------------------------
// Projects made over HTTP
// ---------------------------------------------------------------------------------------------

export interface DecideOptions extends MakeOptions {
  /** The independent review is run before the brief is written. On by default. */
  review?: boolean;
}

/** A finished comparison, and nothing written from it yet: the decision scene offers to write the brief. */
export async function compared(
  api: APIRequestContext,
  options: DecideOptions = {},
): Promise<string> {
  return (await makeProject(api, 'compared', { name: 'Decide: compared', ...options })).id;
}

/** A finished comparison and the brief written from it, with the independent review unless `review` is false. */
export async function briefed(
  api: APIRequestContext,
  options: DecideOptions = {},
): Promise<string> {
  const { review = true, ...rest } = options;
  if (review) return (await makeProject(api, 'brief', { name: 'Decide: brief', ...rest })).id;
  const { id } = await makeProject(api, 'compared', { name: 'Decide: brief', ...rest });
  const written = await api.post(`/api/projects/${id}/brief`, { data: {} });
  expect(written.ok(), await written.text()).toBe(true);
  return id;
}

/** Takes the exploration through the deep dive too (rules mode), so that it has a detailed report. */
export async function withReport(api: APIRequestContext, id: string): Promise<string> {
  for (const step of ['environment', 'simulation', 'report'] as const) {
    await advance(api, id, step);
  }
  return id;
}

/**
 * A brief and a finished deep dive, and no detailed report: it can be written from here, and the studio, which works
 * on it, has nothing to open until it is. The independent review is left out unless `review` is true.
 */
export async function deepDived(
  api: APIRequestContext,
  options: DecideOptions = {},
): Promise<string> {
  const id = await briefed(api, { name: 'Decide: deep dive done', review: false, ...options });
  for (const step of ['environment', 'simulation'] as const) {
    await advance(api, id, step);
  }
  return id;
}

/** A brief, its review and the deep dive's report: every part of the decision scene has something to show. */
export async function everything(
  api: APIRequestContext,
  options: DecideOptions = {},
): Promise<string> {
  return withReport(api, await briefed(api, { name: 'Decide: everything', ...options }));
}

/** Opens the working copy of the report, which is what makes the studio a document and not an invitation. */
export async function openedStudio(api: APIRequestContext, id: string): Promise<StudioView> {
  const response = await api.post(`/api/projects/${id}/studio`, { data: {} });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as StudioView;
}

export async function briefOf(api: APIRequestContext, id: string): Promise<BriefView> {
  const response = await api.get(`/api/projects/${id}/brief`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as BriefView;
}

// ---------------------------------------------------------------------------------------------
// Where things are on the page
// ---------------------------------------------------------------------------------------------

export type DecideView = 'review' | 'report' | 'studio';

/** Opens the decision scene of a project, or one of its views, once what it shows has finished loading. */
export async function openDecide(
  page: Page,
  project: string,
  view?: DecideView,
  options: { theme?: 'light' | 'dark' | 'high-contrast' } = {},
): Promise<void> {
  await openApp(page, { project, scene: 'decide', ...(view ? { view } : {}), ...options });
  // The scene's code and its data arrive after the shell does: the page is there once it has a headline.
  await expect(page.locator('main h1').first()).toBeVisible();
}

export { addressOf };

/** The one sentence that answers the question: the page's only level-one heading. */
export const verdict = (page: Page): Locator =>
  page.getByRole('main').getByRole('heading', { level: 1 });

/** The contents beside the document; the one in the sheet that opens on a phone is not on the page until asked for. */
export const contents = (page: Page): Locator =>
  page.getByRole('navigation', { name: 'Contents of the decision brief' });

/** A chapter of the document by its title (the name of its heading begins with it). */
export const chapter = (page: Page, title: string | RegExp): Locator =>
  page.getByRole('region', { name: beginning(title) });

/** The button that opens and closes a chapter of reference; a chapter of the story has none. */
export const chapterToggle = (page: Page, title: string | RegExp): Locator =>
  page.getByRole('button', { name: beginning(title) });

/** A name that begins with the title, for headings whose names go on with a count or a gist. */
const beginning = (title: string | RegExp): RegExp =>
  title instanceof RegExp
    ? title
    : new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u');

/** The row of tools that stands at the top of the brief: review, edit, export, more. */
export const tools = (page: Page): Locator =>
  page.getByRole('main').getByRole('group', { name: 'Tools for the brief' });

/** Opens the export menu of the brief. */
export async function openExportMenu(page: Page): Promise<Locator> {
  await tools(page).getByRole('button', { name: 'Export' }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  return menu;
}

/** The sheet that holds the independent review. */
export const reviewSheet = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'Independent review' });

/**
 * Opens what a chapter keeps folded away after its first statements, when it keeps any. What is folded is in the page
 * but is neither seen nor pressed (it is inert), so a statement or a note in it is reached by opening it first.
 */
export async function unfold(target: Locator): Promise<void> {
  const more = target.getByRole('button', { name: /^Show \d+ more statements?/u });
  if ((await more.count()) === 0) return;
  await more.first().click();
  await expect(target.getByRole('button', { name: 'Show fewer' }).first()).toBeVisible();
}

// ---------------------------------------------------------------------------------------------
// Who may do what
// ---------------------------------------------------------------------------------------------

/**
 * Makes the server answer as it does to a role that may read the brief and the studio but not change them: the brief
 * says it may not be written again, and the studio that it may not be edited. The server's own answer is used for
 * everything else, so what the page does with a refusal is what is held.
 */
export async function asReader(page: Page, project: string): Promise<void> {
  await page.route(
    (url) => url.pathname === `/api/projects/${project}/brief`,
    async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as BriefView;
      await route.fulfill({ response, json: { ...body, may: { ...body.may, generate: false } } });
    },
  );
  await page.route(
    (url) => url.pathname === `/api/projects/${project}/studio`,
    async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const body = (await response.json()) as StudioView;
      await route.fulfill({
        response,
        json: { ...body, capabilities: { ...body.capabilities, edit: false } },
      });
    },
  );
}

// ---------------------------------------------------------------------------------------------
// What a download holds
// ---------------------------------------------------------------------------------------------

export interface Saved {
  name: string;
  text: string;
}

/** What `act` saves: the name the server gave the file and what is in it. */
export async function saved(page: Page, act: () => Promise<void>): Promise<Saved> {
  const [download] = await Promise.all([page.waitForEvent('download'), act()]);
  const path = await download.path();
  return { name: download.suggestedFilename(), text: await readFile(path, 'utf8') };
}

// ---------------------------------------------------------------------------------------------
// What the page does when it is printed
// ---------------------------------------------------------------------------------------------

export interface Printed {
  pages: number;
  /** All of the text of the printed pages, with every kind of space made one. */
  text: string;
  /** Only its letters and digits, in lower case: what is left when line breaks, punctuation and capitals do not count. */
  flat: string;
  /** Runs of text that lie over other text: nothing is clipped, hidden or laid on top of anything on paper. */
  overlaps: string[];
}

interface TextRun {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

/**
 * Prints the page the way the browser's own print does (print media, A4, backgrounds on) and reads what came
 * out: how many pages, every word of it, and whether any text was drawn over other text. A page break that cuts
 * a grid used to leave one row on top of the next; this is how that is caught.
 */
export async function printed(page: Page): Promise<Printed> {
  await page.emulateMedia({ media: 'print' });
  const pdf = new Uint8Array(await page.pdf({ format: 'A4', printBackground: true }));
  const { totalPages, text } = await extractText(await getDocumentProxy(new Uint8Array(pdf)), {
    mergePages: true,
  });
  const document = await getDocumentProxy(new Uint8Array(pdf));
  const overlaps: string[] = [];
  for (let number = 1; number <= document.numPages; number += 1) {
    const content = await (await document.getPage(number)).getTextContent();
    const runs = (content.items as TextRun[])
      // Text that stands on its end (an axis label) is not a line of text: its box is not the one measured here.
      .filter(
        (item) =>
          typeof item.str === 'string' &&
          item.str.trim() !== '' &&
          item.width > 0 &&
          Math.abs(item.transform[1]!) < 0.01 &&
          Math.abs(item.transform[2]!) < 0.01,
      )
      .map((item) => ({
        str: item.str,
        x0: item.transform[4]!,
        x1: item.transform[4]! + item.width,
        y0: item.transform[5]!,
        y1: item.transform[5]! + Math.max(item.height, 1),
      }));
    for (let first = 0; first < runs.length; first += 1) {
      for (let second = first + 1; second < runs.length; second += 1) {
        const a = runs[first]!;
        const b = runs[second]!;
        const across = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const down = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        if (across <= 1 || down <= 1) continue;
        const smaller = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
        if (smaller > 0 && (across * down) / smaller > 0.35) {
          overlaps.push(`page ${number}: "${a.str.slice(0, 30)}" over "${b.str.slice(0, 30)}"`);
        }
      }
    }
  }
  const joined = String(text);
  return {
    pages: totalPages,
    text: joined.replace(/\s+/gu, ' '),
    flat: lettersOf(joined),
    overlaps,
  };
}

const lettersOf = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Whether the printed text holds these words: wherever the lines were broken, and whatever the punctuation and
 * the capitals (a label is set in capitals, and the colon after it is drawn as a gap).
 */
export const holds = (printed_: Printed, words: string): boolean =>
  printed_.flat.includes(lettersOf(words));

// ---------------------------------------------------------------------------------------------
// The shape of the page
// ---------------------------------------------------------------------------------------------

/** How much page there is after the end of the main region: a document ends with what it says. */
export async function blankAfterMain(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.documentElement.scrollHeight -
      Math.round(document.querySelector('main')!.getBoundingClientRect().bottom + window.scrollY),
  );
}

/** The distance in pixels between the top of an element and the top of the window. */
export const topOf = (target: Locator): Promise<number> =>
  target.evaluate((element) => element.getBoundingClientRect().top);

// ---------------------------------------------------------------------------------------------
// The report studio
// ---------------------------------------------------------------------------------------------

type StudioDocument = NonNullable<StudioView['document']>;

/** The studio as a whole: the page that holds the working copy. */
export const studio = (page: Page): Locator => page.getByRole('region', { name: 'Report studio' });

/** Where the report stands in its review, and the buttons that move it on. */
export const workflow = (page: Page): Locator =>
  studio(page).getByRole('group', { name: 'Review workflow' });

/** The sections of the working copy, one button each. */
export const sectionsOf = (page: Page): Locator =>
  studio(page).getByRole('navigation', { name: 'Report sections' });

/** The section in view, as a page. */
export const sectionPage = (page: Page): Locator => studio(page).getByRole('article');

/** The tools of the section in view: notes, history, statements, rewrite. */
export const sectionTools = (page: Page): Locator =>
  studio(page).getByRole('complementary', { name: 'Tools for this section' });

/** The working copy as the server holds it, for what the page must agree with. */
export async function studioDocument(
  api: APIRequestContext,
  project: string,
): Promise<StudioDocument> {
  const response = await api.get(`/api/projects/${project}/studio`);
  expect(response.ok(), await response.text()).toBe(true);
  const { document } = (await response.json()) as StudioView;
  expect(document, 'the studio has been opened').not.toBeNull();
  return document!;
}

/** Opens the studio of a project at its address, once what it shows has finished loading. */
export async function openStudio(
  page: Page,
  project: string,
  options: { theme?: 'light' | 'dark' | 'high-contrast' } = {},
): Promise<void> {
  await openDecide(page, project, 'studio', options);
}

/** Opens the studio and makes the working copy, so that there is a document to work on. */
export async function startStudio(
  page: Page,
  project: string,
  options: { theme?: 'light' | 'dark' | 'high-contrast' } = {},
): Promise<void> {
  await openStudio(page, project, options);
  await page.getByRole('button', { name: 'Open in the studio' }).click();
  await expect(workflow(page)).toContainText('Revision 1');
}

/** Chooses a section of the working copy by its title, from the outline. */
export async function chooseSection(page: Page, title: string | RegExp): Promise<void> {
  await sectionsOf(page)
    .getByRole('button', { name: beginning(title) })
    .click();
  await expect(sectionPage(page).getByRole('heading', { level: 2 })).toHaveText(
    title instanceof RegExp ? title : new RegExp(`^${title}$`, 'u'),
  );
}

/** Opens a tool of the section in view (Notes, History, Statements, Rewrite). */
export async function openTool(page: Page, name: string | RegExp): Promise<Locator> {
  const tab = sectionTools(page).getByRole('tab', { name });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  return sectionTools(page).getByRole('tabpanel');
}

// ---------------------------------------------------------------------------------------------
// A report written by a model
// ---------------------------------------------------------------------------------------------

/**
 * A model-assisted exploration with the brief and the deep dive's report, made through the real stages against the
 * provider the server was started with. The report is the provider's, so its chapters have statements that were checked
 * against the sources and can be written again.
 */
export async function modelReport(api: APIRequestContext, name: string): Promise<string> {
  const id = await createGuided(api, { name, mode: 'llm', agents: 4, rounds: 3 });
  await advance(api, id, 'knowledge');
  const found = await api.post(`/api/projects/${id}/stakeholders/discover`, {
    data: { mode: 'rules' },
  });
  expect(found.status(), await found.text()).toBe(201);
  const { revision } = (await found.json()) as { revision: number };
  const approved = await api.post(`/api/projects/${id}/stakeholders/approve`, {
    data: { expectedRevision: revision },
  });
  expect(approved.status(), await approved.text()).toBe(200);
  const actors = await api.post(`/api/projects/${id}/actors/generate`, { data: {} });
  expect(actors.status(), await actors.text()).toBe(201);
  const started = await api.post(`/api/projects/${id}/analysis`, { data: { runsPerVariant: 10 } });
  expect(started.status(), await started.text()).toBe(202);
  const { analysis } = (await started.json()) as { analysis: { id: string } };
  await expect
    .poll(
      async () =>
        (
          (await (await api.get(`/api/projects/${id}/analysis/${analysis.id}`)).json()) as {
            analysis: { status: string };
          }
        ).analysis.status,
      { timeout: 120_000, intervals: [100, 250, 500] },
    )
    .toBe('completed');
  for (const step of ['environment', 'simulation', 'report'] as const) {
    await advance(api, id, step);
  }
  return id;
}
