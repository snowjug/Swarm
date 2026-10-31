import { expect } from 'vitest';
import type { GroundedClaim, GroundingReview } from '../../../shared/grounding.js';
import type { StudioView } from '../../../shared/studio.js';
import { buildApp } from '../../src/app.js';
import { fixtureInput, testConfig } from '../fixtures.js';

// A project whose report and statements are written out here, so that what each statement may be called
// is known before the studio is asked. Shared by the Report Studio tests.

/** Planted in everything a person types: the audit log may hold ids and counts, and must never hold this. */
export const CANARY = 'zq-canary-9137';
const COUNCIL =
  'Annual ferry ridership reached 412,000 passengers in 2024 according to the island council. ' +
  'The council supports the electric ferry plan for the island route this winter.';
const OPERATOR =
  'Annual ferry ridership was 365,000 passengers in 2024 according to the ferry operator. ' +
  'The operator reports it will deliver the island route plan with the current diesel vessel.';

const applications: Awaited<ReturnType<typeof buildApp>>[] = [];
/** Closes every application a test opened. Each test file runs this after each test. */
export async function closeApplications(): Promise<void> {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
}

function grounded(overrides: Partial<GroundedClaim>): GroundedClaim {
  return {
    id: 'C1',
    section: 'Evidence',
    text: 'The council supports the electric ferry plan for the island route.',
    kind: 'extracted-claim',
    sourceIds: ['S1'],
    memoryIds: [],
    quote: null,
    verdict: 'supported',
    checks: { quote: null, overlap: 0.9, numbers: null, entailment: null },
    reason: 'Matches the cited passage.',
    ...overrides,
  };
}

const NONE = { quote: null, overlap: null, numbers: null, entailment: null } as const;

/** One statement of every kind of outcome the publication policy has. */
export function review(): GroundingReview {
  const claims = [
    // A finding: a source passage states it and nothing conflicts with it.
    grounded({ id: 'C1' }),
    // Qualified: a cited passage backs only part of it.
    grounded({
      id: 'C2',
      text: 'The operator reports it will deliver the island route plan.',
      sourceIds: ['S2'],
      verdict: 'partial',
    }),
    // Not checkable: the model's own guess.
    grounded({
      id: 'C3',
      text: 'Residents may switch to the ferry if fares fall.',
      kind: 'ai-hypothesis',
      sourceIds: [],
      verdict: 'unchecked',
      checks: NONE,
    }),
    // Supported by one source, and an open conflict between sources touches its figure.
    grounded({ id: 'C4', text: 'The council note reports 412,000 annual passengers.' }),
    // No cited passage backs it: a hypothesis, never a finding.
    grounded({
      id: 'C5',
      section: 'Outlook',
      text: 'Ferry fares will halve next year.',
      verdict: 'unsupported',
      checks: { quote: null, overlap: 0.1, numbers: 'mismatch', entailment: 'not-supported' },
      reason: 'No cited passage says this.',
    }),
    // A passage says the opposite: shown only together with it.
    grounded({
      id: 'C6',
      section: 'Outlook',
      text: 'The council opposes the electric ferry plan.',
      verdict: 'contradicted',
      checks: {
        quote: null,
        overlap: 0.8,
        numbers: null,
        entailment: 'contradicts',
        entailmentQuote: 'The council supports the electric ferry plan for the island route',
      },
      reason: 'A cited passage says the opposite.',
    }),
    // Something that happened in the simulation: labelled as such.
    grounded({
      id: 'C7',
      section: 'Outlook',
      text: 'A fictional proxy replied in round three.',
      kind: 'simulated-event',
      sourceIds: [],
      memoryIds: ['M1'],
      verdict: 'supported',
    }),
  ];
  return {
    checkedAt: '2026-10-29T09:00:00.000Z',
    method: 'deterministic+model',
    claims,
    counts: { supported: 3, partial: 1, unsupported: 1, contradicted: 1, unchecked: 1 },
    unverifiedFigures: [],
    notes: [],
  };
}

export function generatedReport() {
  return {
    generatedBy: 'llm' as const,
    title: 'Ferry report',
    executiveSummary: 'A conditional summary of the ferry scenario, written by the model.',
    sections: [
      { title: 'Evidence', body: 'Body of the evidence chapter.', sourceIds: ['S1', 'S2'] },
      { title: 'Outlook', body: 'Body of the outlook chapter.', sourceIds: ['S1'] },
    ],
    limitations: ['This is not a forecast.', 'Personas are fictional.'],
    grounding: review(),
    metrics: {
      initialMean: 0,
      finalMean: 0.2,
      finalSupport: 0.5,
      finalOpposition: 0.3,
      polarization: 0.2,
      totalInteractions: 10,
    },
  };
}

export async function harness(options: { report?: boolean; documentName?: string } = {}) {
  const instance = await buildApp({ config: testConfig() });
  applications.push(instance);
  const { app, repository } = instance;
  const project = repository.create(
    fixtureInput({
      workflow: 'guided',
      name: 'Ferry scenario',
      documents: [
        { name: options.documentName ?? 'council-note.md', content: COUNCIL },
        { name: 'operator-memo.md', content: OPERATOR },
      ],
    }),
  );
  if (options.report !== false) {
    repository.update(project.id, { status: 'completed', report: generatedReport() });
  }
  const url = (path = '') => `/api/projects/${project.id}/studio${path}`;
  const call = (method: 'GET' | 'POST' | 'PUT', path: string, payload?: unknown) =>
    app.inject({
      method,
      url: url(path),
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const view = async (): Promise<StudioView> => (await call('GET', '')).json();
  const start = async (): Promise<StudioView> => {
    const response = await call('POST', '', {});
    expect(response.statusCode, response.body).toBe(201);
    return response.json();
  };
  const sectionOf = (current: StudioView, id: string) =>
    current.document!.sections.find((section) => section.id === id)!;
  const edit = async (id: string, body: string) => {
    const current = await view();
    return call('PUT', `/sections/${id}`, {
      body,
      expectedVersion: sectionOf(current, id).version,
      reason: null,
    });
  };
  const transition = async (kind: string, note: string | null = null) => {
    const current = await view();
    return call('POST', `/${kind}`, { expectedRevision: current.document!.revision, note });
  };
  return { ...instance, project, url, call, view, start, edit, transition, sectionOf };
}

/** The part of the memo under one heading. */
export function under(html: string, heading: string): string {
  const start = html.indexOf(`<h2>${heading}</h2>`);
  if (start < 0) throw new Error(`The memo has no heading "${heading}".`);
  const next = html.indexOf('<h2>', start + 4);
  return html.slice(start, next < 0 ? undefined : next);
}
export const idsIn = (html: string): string[] =>
  [...html.matchAll(/<span class="id">([A-Z]\d+)<\/span>/gu)].map((match) => match[1]!);
