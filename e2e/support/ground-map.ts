import AxeBuilder from '@axe-core/playwright';
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { isOpenConflict, type ContradictionRecord, type Ledger } from '../../shared/evidence';
import { EXAMPLE_SCENARIOS } from '../../shared/example-scenarios';
import type { SourceProvenance } from '../../shared/scenario';
import type {
  ActorsView,
  Stakeholder,
  StakeholdersView,
  TraitKey,
  TraitOrigin,
} from '../../shared/stakeholders';
import type { EvidenceChunk, ProjectDetail } from '../../shared/types';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  expectReadableText,
  expectTargetSizes,
  expectTouchTargets,
} from './helpers';
import { squash } from './lab-api';

// What the specs of the Ground scene (the evidence the exploration rests on) and of the Map scene (who is in
// play) share: projects made over HTTP up to a chosen point, what the server holds of them, and the places on
// each screen found the way a person finds them, by role and name. Nothing here knows a domain: the sources a
// project is made from are passed in.

// ---------------------------------------------------------------------------------------------
// Sources a project is made from
// ---------------------------------------------------------------------------------------------

export interface Seed {
  title: string;
  question: string;
  documents: { name: string; content: string; provenance?: SourceProvenance }[];
}

/** Two fictional notes that give different figures for the same count: the smallest source with a conflict in it. */
export const FERRY: Seed = {
  title: 'Ground and Map: two sources that disagree',
  question: 'How might fictional ferry stakeholders respond to the proposed timetable?',
  documents: [
    {
      name: 'council-note.md',
      content:
        'Fictional briefing note for testing. Council counts show 412,000 one-way crossings in 2025. The council has not agreed any change to the winter timetable.',
    },
    {
      name: 'operator-memo.md',
      content:
        'Fictional memo for testing. Our ticketing system recorded 365,000 one-way crossings in 2025. The operator is reviewing the winter timetable with the council.',
    },
  ],
};

/** The same two notes, with the same figure in both: nothing to settle. */
export const AGREE: Seed = {
  title: 'Ground and Map: two sources that agree',
  question: FERRY.question,
  documents: [
    FERRY.documents[0]!,
    {
      name: 'operator-memo.md',
      content:
        'Fictional memo for testing. Our ticketing system recorded 412,000 one-way crossings in 2025. The operator is reviewing the winter timetable with the council.',
    },
  ],
};

/** The sources of one of the shipped examples, which several documents and many roles make a real test of the engine. */
export function exampleSeed(id: (typeof EXAMPLE_SCENARIOS)[number]['id']): Seed {
  const example = EXAMPLE_SCENARIOS.find((candidate) => candidate.id === id);
  if (!example) throw new Error(`There is no example "${id}" in shared/example-scenarios.ts.`);
  return {
    title: `Ground and Map: ${example.title}`,
    question: example.question,
    documents: example.documents.map(({ name, content, provenance }) => ({
      name,
      content,
      provenance,
    })),
  };
}

/** A short fictional note for a project whose model is the fake provider: the question and the sources the old suite used. */
export const LIBRARY: Seed = {
  title: 'Grounding: a model reads the library notes',
  question:
    'How might fictional community groups respond to a proposed change in library opening hours?',
  documents: [
    {
      name: 'library-notes.md',
      content: [
        'This is a fictional scenario for testing a proposed change to public library opening hours.',
        'The Library Service proposes opening until nine in the evening on weekdays and closing earlier on Sundays.',
        'Residents who work late support longer evening hours, while some neighbours worry about noise and staffing costs.',
        'The Local Council asks for usage evidence before approving any extra budget for the library.',
        'No survey has measured support. These notes describe proposed actions, not observed outcomes.',
      ].join('\n'),
    },
  ],
};

/** A briefing about a city's congestion charge: not an example, so nothing in the product has seen it before. */
export const CITY: Seed = {
  title: 'Ground and Map: a city charge',
  question:
    'What could happen if the city introduces a congestion charge for private cars entering the central zone on weekdays?',
  documents: [
    {
      name: 'council-briefing.txt',
      content: `Illustrative synthetic briefing written for a test; the figures are invented and it describes no real city.

The city council is considering a congestion charge for private cars that enter the central zone on weekdays between seven in the morning and seven in the evening. Residents who live inside the zone would receive a discount, and the transport authority would run the cameras and collect the payments.

Commuters who drive to work in the zone say the charge would cost them more than a monthly bus pass. Shop owners on the main shopping street worry that customers will drive to the retail park outside the zone instead. Bus operators expect more passengers but say they have no spare vehicles at peak times. Delivery contractors ask whether vans will pay the full charge, and taxi operators ask for the same exemption that buses receive.

Disability advocates ask that drivers with a blue badge are exempt. An environmental campaign group supports the charge because it expects cleaner air near the schools. The finance committee of the council wants to know how much revenue the charge would bring in, but no estimate has been made. No survey has measured support, and these notes describe proposals, not observed outcomes.
`,
    },
  ],
};

export const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

// ---------------------------------------------------------------------------------------------
// Projects made over HTTP
// ---------------------------------------------------------------------------------------------

/** How far along the journey a project is made: each stage holds what the one before it does. */
export type Stage = 'draft' | 'ground' | 'proposed' | 'approved' | 'actors';
const RANK: Record<Stage, number> = { draft: 0, ground: 1, proposed: 2, approved: 3, actors: 4 };

async function ok<T>(response: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  expect(response.ok(), `${response.url()}: ${response.status()} ${await response.text()}`).toBe(
    true,
  );
  return (await response.json()) as T;
}

export const recordOf = async (api: APIRequestContext, id: string): Promise<ProjectDetail> =>
  ok<ProjectDetail>(await api.get(`/api/projects/${id}`));

export const passagesOf = async (api: APIRequestContext, id: string): Promise<EvidenceChunk[]> =>
  (await ok<{ matches: EvidenceChunk[] }>(await api.get(`/api/projects/${id}/evidence?query=`)))
    .matches;

export const ledgerOf = async (api: APIRequestContext, id: string): Promise<Ledger> =>
  ok<Ledger>(await api.get(`/api/projects/${id}/ledger`));

/** The conflicts that weigh on the statements: possible or confirmed, not dismissed or resolved. */
export const openConflicts = (ledger: Ledger): ContradictionRecord[] =>
  ledger.contradictions.filter((conflict) => isOpenConflict(conflict.status));

export const stakeholdersViewOf = async (
  api: APIRequestContext,
  id: string,
): Promise<StakeholdersView> =>
  ok<StakeholdersView>(await api.get(`/api/projects/${id}/stakeholders`));

export const actorsViewOf = async (api: APIRequestContext, id: string): Promise<ActorsView> =>
  ok<ActorsView>(await api.get(`/api/projects/${id}/actors`));

/** The stakeholders a person sees: those that are not removed. */
export const live = (view: StakeholdersView): Stakeholder[] =>
  (view.stakeholders?.stakeholders ?? []).filter((stakeholder) => stakeholder.status !== 'removed');

const made = new WeakMap<APIRequestContext, string[]>();

/**
 * Takes away the projects a test made through this context. The server keeps at most a hundred, and a spec that
 * makes one for each test must give them back; it is called after each test, whether the test passed or not.
 */
export async function deleteMade(api: APIRequestContext): Promise<void> {
  for (const id of made.get(api) ?? []) await api.delete(`/api/projects/${id}`);
  made.delete(api);
}

export interface MakeOptions {
  /** `llm` makes a project on a server that has a model (the fake provider); rules mode otherwise. */
  mode?: 'local' | 'llm';
  agents?: number;
  rounds?: number;
}

/**
 * Makes a guided project the way the pages do, up to a stage: the evidence is read (`ground`), stakeholders are
 * found by reading the text (`proposed`), approved (`approved`) and made into actors (`actors`).
 */
export async function makeProject(
  api: APIRequestContext,
  seed: Seed,
  stage: Stage = 'ground',
  options: MakeOptions = {},
): Promise<string> {
  const created = await ok<{ id: string }>(
    await api.post('/api/projects', {
      data: {
        name: seed.title,
        question: seed.question,
        workflow: 'guided',
        documents: seed.documents,
        settings: {
          mode: options.mode ?? 'local',
          agentCount: options.agents ?? 6,
          rounds: options.rounds ?? 4,
          seed: 42,
          network: 'community',
        },
      },
    }),
  );
  const { id } = created;
  made.set(api, [...(made.get(api) ?? []), id]);
  const reached = (needed: Stage): boolean => RANK[stage] >= RANK[needed];
  if (reached('ground')) await runStep(api, id, 'knowledge');
  let revision = 0;
  if (reached('proposed')) {
    const found = await api.post(`/api/projects/${id}/stakeholders/discover`, {
      data: { mode: 'rules' },
    });
    expect(found.status(), await found.text()).toBe(201);
    revision = ((await found.json()) as { revision: number }).revision;
  }
  if (reached('approved')) {
    const approved = await api.post(`/api/projects/${id}/stakeholders/approve`, {
      data: { expectedRevision: revision },
    });
    expect(approved.status(), await approved.text()).toBe(200);
  }
  if (reached('actors')) {
    const made = await api.post(`/api/projects/${id}/actors/generate`, { data: {} });
    expect(made.status(), await made.text()).toBe(201);
  }
  return id;
}

type GuidedStep = 'knowledge' | 'environment' | 'simulation' | 'report';

/** Starts one step of the guided flow, over HTTP, and waits until it is stored as ready. */
export async function runStep(
  api: APIRequestContext,
  id: string,
  step: GuidedStep,
  timeout = 60_000,
): Promise<void> {
  const started = await api.post(`/api/projects/${id}/steps/${step}`, { data: {} });
  expect(started.status(), await started.text()).toBe(202);
  await expect
    .poll(async () => (await recordOf(api, id)).console?.steps[step], {
      timeout,
      intervals: [100, 250, 500],
    })
    .toBe('ready');
}

/** A record the guided flow did not make: it has its sources and one finished run, and nothing to start. */
export async function makeLegacy(api: APIRequestContext, seed: Seed): Promise<string> {
  const created = await ok<{ id: string }>(
    await api.post('/api/projects', {
      data: {
        name: `${seed.title} (a saved record)`,
        question: seed.question,
        documents: seed.documents,
        settings: { mode: 'local', agentCount: 6, rounds: 3, seed: 42, network: 'community' },
      },
    }),
  );
  made.set(api, [...(made.get(api) ?? []), created.id]);
  const started = await api.post(`/api/projects/${created.id}/run`, { data: {} });
  expect(started.status(), await started.text()).toBe(202);
  await expect
    .poll(async () => (await recordOf(api, created.id)).status, { timeout: 90_000 })
    .toBe('completed');
  return created.id;
}

// ---------------------------------------------------------------------------------------------
// What every screen is held to
// ---------------------------------------------------------------------------------------------

/** What a person fails on, in the state the page is in now: no sideways scroll, readable type and axe. */
export async function expectSound(
  page: Page,
  label: string,
  options: { without?: readonly KnownFlaw[] } = {},
): Promise<void> {
  await expectNoHorizontalOverflow(page);
  await expectReadableText(page, label);
  const known = options.without ?? [];
  if (known.length === 0) {
    await expectNoAxeViolations(page, label);
    return;
  }
  const floating =
    (await page.locator('[role="menu"], [data-radix-popper-content-wrapper]').count()) > 0;
  const builder = new AxeBuilder({ page });
  const result = await (floating ? builder.disableRules(['region']) : builder).analyze();
  const found = result.violations.flatMap((violation) => {
    const nodes = violation.nodes.filter(
      (node) =>
        !known.some(
          (flaw) => flaw.rule === violation.id && node.target.join(' ').includes(flaw.selector),
        ),
    );
    return nodes.length > 0
      ? [`${violation.impact}: ${violation.id} ×${nodes.length} (${nodes[0]?.target.join(' ')})`]
      : [];
  });
  expect(found, `axe violations: ${label}`).toEqual([]);
}

/**
 * A flaw that a test of its own already shows: one rule, on one control. A sweep leaves just that out, so that it is not
 * what every state of every sweep reports and hides what else is wrong. Fixing it leaves nothing to leave out.
 */
export interface KnownFlaw {
  rule: string;
  selector: string;
}

/** Every control a pointer has to reach is big enough: 24 CSS pixels, and 44 where a finger is the pointer. */
export async function expectReachable(
  page: Page,
  label: string,
  options: { touch?: boolean } = {},
): Promise<void> {
  await expectTargetSizes(page, label);
  if (options.touch) await expectTouchTargets(page, label);
}

/** The words of a quotation with the marks a page puts round it taken off. */
export const unquoted = (text: string): string =>
  text
    .trim()
    .replace(/^[\u201c"]\s*/u, '')
    .replace(/\s*[\u201d"]$/u, '');

/** Whether a quotation is, word for word, in one of the documents of the project (see `squash`). */
export const inDocuments = (quote: string, documents: readonly { content: string }[]): boolean => {
  const wanted = squash(unquoted(quote));
  return wanted.length > 0 && documents.some((doc) => squash(doc.content).includes(wanted));
};

/** The first run of digits in a text, as a number; null when there is none. */
export const numberIn = (text: string): number | null => {
  const found = /\d[\d,]*/u.exec(text);
  return found ? Number(found[0].replaceAll(',', '')) : null;
};

/** Every control inside `scope` lies inside the viewport and inside `scope` itself: nothing is cut off at an edge. */
export async function expectControlsInside(scope: Locator, label: string): Promise<void> {
  const outside = await scope.evaluate((root) => {
    const box = root.getBoundingClientRect();
    const found: string[] = [];
    for (const control of root.querySelectorAll('button, a, input, select, textarea')) {
      const at = control.getBoundingClientRect();
      if (!at.width || !at.height) continue;
      const name = (control.getAttribute('aria-label') ?? control.textContent ?? '').trim();
      if (
        at.left < box.left - 1 ||
        at.right > box.right + 1 ||
        at.right > window.innerWidth + 1 ||
        at.left < -1
      ) {
        found.push(
          `"${name.slice(0, 24)}" spans ${Math.round(at.left)}–${Math.round(at.right)}, the area ${Math.round(box.left)}–${Math.round(box.right)}, the screen ${window.innerWidth}`,
        );
      }
    }
    return found;
  });
  expect(outside, `controls cut off: ${label}`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------
// Ground: the places on the screen
// ---------------------------------------------------------------------------------------------

export const GROUND_VIEWS = ['graph', 'sources', 'conflicts', 'statements', 'trace'] as const;

/** The first screen of the scene: the question, the figures, the action and the picture. */
export const hero = (page: Page, seed: Pick<Seed, 'question'>): Locator =>
  page.getByRole('region', { name: seed.question });

export type FigureName = 'Sources' | 'Passages' | 'Topics' | 'Entities' | 'Conflicts';

/** One of the four figures that answer what the evidence is. */
export const figure = (page: Page, name: FigureName): Locator =>
  page
    .getByRole('listitem')
    .filter({ hasText: new RegExp(`^\\s*(?:\\d[\\d,]*|–)\\s*${name}`, 'u') })
    .first();

/** A figure's value: a number, or null while the engine has not said (it is a dash). */
export async function figureValue(page: Page, name: FigureName): Promise<number | null> {
  return numberIn(await figure(page, name).innerText());
}

export const sourcesSection = (page: Page): Locator =>
  page.getByRole('region', { name: /^Sources \d+$/u });
/** The button that opens a source: it reads as its key and its file name, "D1 council-note.md". */
export const sourceButton = (scope: Page | Locator, name: string): Locator =>
  scope.getByRole('button', { name: new RegExp(`^D\\d+ ${escapeRegExp(name)}$`, 'u') });
export const conflictsSection = (page: Page): Locator =>
  page.getByRole('region', { name: /^Conflicts \d+$/u });
export const statementsSection = (page: Page): Locator =>
  page.getByRole('region', { name: /^Statements \d+$/u });
export const operationsSection = (page: Page): Locator =>
  page.getByRole('region', { name: 'Operations' });
export const graph = (page: Page): Locator => page.getByRole('group', { name: /^Source graph: / });
/** A topic (or entity) of the graph, by its label. */
export const topic = (page: Page, label: string): Locator =>
  graph(page).getByRole('button', { name: new RegExp(`^${escapeRegExp(label)}, `, 'u') });
export const topicDetails = (page: Page, label: string): Locator =>
  page.getByRole('region', { name: `${label}: details` });
export const conflictCard = (page: Page, id: string): Locator =>
  page.getByRole('article', { name: new RegExp(`^${id}: `, 'u') });
/** The sheet that opens from the side (from the bottom on a phone) to read a document, a passage or a statement. */
export const sheet = (page: Page): Locator => page.getByRole('dialog');
/** A passage's button in the list of sources. */
export const passageButton = (page: Page, id: string): Locator =>
  sourcesSection(page).getByRole('button', { name: new RegExp(`^Passage ${id}, `, 'u') });
/** The word at the head of the page that says where the evidence is: Reading, Extracting, Checking, Ready, Failed. */
export const groundStatus = (page: Page, word: string | RegExp): Locator =>
  page.locator('[data-moment]').filter({ hasText: word });
/** What the engine said it is doing, for people who cannot see the page change. */
export const readyStatus = (page: Page): Locator =>
  page.getByRole('status').filter({ hasText: /^(?:Ready|Reading|Waiting|Stopped|Saved)/u });

/** The text of a sheet's document, exactly as it is drawn: the passage markers that sit between the words are not part of it. */
export async function documentTextOf(scope: Locator): Promise<string> {
  return scope.locator('[lang="en"]').evaluate((root) => {
    const copy = root.cloneNode(true) as HTMLElement;
    for (const marker of copy.querySelectorAll('[aria-hidden="true"]')) marker.remove();
    return copy.textContent ?? '';
  });
}

// ---------------------------------------------------------------------------------------------
// Map: the places on the screen
// ---------------------------------------------------------------------------------------------

export const mapRegion = (page: Page): Locator =>
  page.getByRole('region', { name: 'Who is in play' });
/** The picture: a group whose members are the parties (and the places where nobody was found). */
export const ecosystem = (page: Page): Locator =>
  page.getByRole('group', { name: /(?:Stakeholders|Actors) and how they relate$/u });
export const GAP_NAME = /^Nobody found for /u;

/** One party of the picture, by its name. */
export const party = (page: Page, name: string): Locator =>
  ecosystem(page).getByRole('button', { name: new RegExp(`^${escapeRegExp(name)}, `, 'u') });
/** The places where nobody was found for a kind of party. */
export const gapNodes = (page: Page): Locator =>
  ecosystem(page).getByRole('button', { name: GAP_NAME });
/** Every party that is drawn (not the gaps). */
export const partyNodes = (page: Page): Locator =>
  ecosystem(page).getByRole('button', { name: /^(?!Nobody found for )/u });

/** The names of the parties on the map, in the order they are reached. */
export async function partyNames(page: Page): Promise<string[]> {
  const labels = await partyNodes(page).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('aria-label') ?? ''),
  );
  return labels.map((label) => label.split(', ')[0] ?? label);
}

/** The party that is open: a panel beside the map, or a strip under it on a phone. */
export const inspector = (page: Page, name: string): Locator =>
  page
    .getByRole('complementary', { name, exact: true })
    .or(page.getByRole('region', { name, exact: true }));
/** Waits until a control has stopped moving: a strip that is still sliding in is not yet under the finger that taps it. */
export async function holdsStill(control: Locator): Promise<void> {
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
/** The one thing to do next. While it changes over, the one that is leaving is still there beside it: the last is the new one. */
export const pill = (page: Page): Locator => page.getByRole('group', { name: 'Next' }).last();
export const mapControls = (page: Page): Locator =>
  page.getByRole('toolbar', { name: 'Map controls' });
export const roster = (page: Page): Locator =>
  page.getByRole('region', { name: /^(?:Stakeholders, key actors first|Actors)$/u });
/** A party's row in the list. */
export const rosterRow = (page: Page, name: string): Locator =>
  roster(page).getByRole('button', { name: new RegExp(`^${escapeRegExp(name)}(?: |$)`, 'u') });

export interface Headline {
  /** Parties or actors, as the page counts them. */
  total: number;
  key: number;
  toReview: number;
}

/** "15 parties · 4 key · 15 to review", read as a person reads it. */
export async function headline(page: Page): Promise<Headline> {
  const text = await mapRegion(page)
    .locator('p', { hasText: /\d+\s+key/u })
    .first()
    .innerText();
  const read = (pattern: RegExp): number => Number(pattern.exec(text)?.[1] ?? 0);
  return {
    total: read(/(\d+)\s+(?:parties|party|actors?)/u),
    key: read(/(\d+)\s+key/u),
    toReview: read(/(\d+)\s+to review/u),
  };
}

/** Finds the stakeholders the way the first screen of the scene offers to, and waits for the map. */
export async function findWho(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Find who is affected' }).click();
  await expect(ecosystem(page)).toBeVisible();
}

/** The toast, if any, that says what the page did. */
export const toast = (page: Page, title: string | RegExp): Locator =>
  page.getByRole('region', { name: 'Notifications' }).getByText(title);

// ---------------------------------------------------------------------------------------------
// The way a page is opened, and what it says
// ---------------------------------------------------------------------------------------------

/** Opens every page of this context in Advanced mode, the way the person's own choice would be kept. */
export async function inAdvancedMode(page: Page): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('swarm.mode', 'advanced'));
}

/**
 * Makes the page read a project as it would be at another point of its work. The server's answer for the project is
 * taken and changed (the one thing that cannot be held still in rules mode: a step that is under way, or that failed);
 * the real server is used for everything else, so that what the person does next is real. The returned function puts
 * the server's own answer back.
 */
export async function readProjectAs(
  page: Page,
  id: string,
  change: (project: ProjectDetail) => void,
): Promise<() => Promise<void>> {
  const pattern = new RegExp(`/api/projects/${id}$`, 'u');
  let rewriting = true;
  await page.route(pattern, async (route) => {
    if (!rewriting || route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = (await response.json()) as ProjectDetail;
    // A read that was under way when the server's own answer was put back gets that answer, not a changed one.
    if (rewriting) change(body);
    // The page reads a busy project again and again: a read that lands as the route is taken away has nothing to answer.
    await route.fulfill({ response, json: body }).catch(() => undefined);
  });
  return async () => {
    rewriting = false;
    await page.unroute(pattern);
  };
}

/**
 * The page's own sentences: what the product says, apart from what a source said and a person wrote (the quotes,
 * the figures taken out of a source, the question). A claim about the world is judged only in these.
 */
export async function ownSentences(scope: Locator): Promise<string[]> {
  return scope
    .locator(
      'p:not(figure p, blockquote p), h2, h3, h4, li, button, dd, dt, label, [role="status"], [role="alert"]',
    )
    .evaluateAll((elements) =>
      elements
        .filter((element) => !element.closest('blockquote, figure, svg, [lang]:not(html)'))
        .map((element) => (element.textContent ?? '').replace(/\s+/gu, ' ').trim())
        .filter(Boolean),
    );
}

/**
 * What the page says of itself that denies a forecast, set apart from every other sentence: "does not predict what
 * real people will do", "supports that the group is in the evidence, not how it will react". A sentence that says what
 * will not be known is the honesty, and is kept apart so that a claim is judged in what is left.
 */
export function apartFromDisclaimers(sentences: readonly string[]): {
  disclaimers: string[];
  rest: string[];
} {
  const denial =
    /\b(?:does not|do not|never|not)\s+(?:guarantee or\s+)?(?:precisely\s+)?predict|\b(?:not|never|nor)\b[^.;:]*\b(?:will|would|going to)\b/iu;
  return {
    disclaimers: sentences.filter((sentence) => denial.test(sentence)),
    rest: sentences.filter((sentence) => !denial.test(sentence)),
  };
}

// ---------------------------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------------------------

/** What a trait is called on the page, in the order the page lists them. */
export const TRAIT_NAMES: Record<TraitKey, string> = {
  priorStance: 'Starting stance',
  impact: 'Impact on them',
  influence: 'Influence',
  openness: 'Openness',
  sensitivity: 'Sensitivity',
  riskTolerance: 'Risk tolerance',
  switchingCost: 'Switching cost',
  trust: 'Trust',
  adoptionTendency: 'Readiness to adopt',
  authority: 'Authority',
  reactivity: 'Reactivity',
};

/** Where a number came from, as the page says it. */
export const ORIGIN_WORDS: Record<TraitOrigin, string> = {
  'system-assumption': 'assumption',
  evidence: 'evidence',
  model: 'model',
  user: 'you',
};

/** An actor's slider for a trait. */
export const traitSlider = (page: Page, key: TraitKey, actor: string): Locator =>
  page.getByRole('slider', { name: `${TRAIT_NAMES[key]} of ${actor}`, exact: true });
