import { describe, expect, it } from 'vitest';
import { claimsAgainst } from '../../../../e2e/support/claims';
import { researchIntakeSchema } from '../../../../shared/research';
import { scenarioFixture } from '../../../../shared/lab-fixtures';
import type { AppConfig, CreateProjectInput } from '../../../../shared/types';
import {
  CAPABILITIES,
  CAPABILITY_IDS,
  capabilityFlags,
  constraintsEnabled,
  researchEnabled,
} from './capabilities';
import { flowSteps } from './flow';
import {
  ADDRESS_MAX,
  classifySite,
  GUIDANCE_MAX,
  HORIZONS,
  horizonText,
  researchIntake,
  validateIntake,
  withIntake,
} from './research';
import { firstBlank, leftBlank, PROMPTS, TEMPLATES } from './templates';

const config = (extra: Record<string, unknown> = {}): AppConfig => ({ ...extra }) as never;

describe('what the server says it can do', () => {
  it('has research only when the server says so with a true, and not when it says nothing, or something else', () => {
    expect(researchEnabled(null)).toBe(false);
    expect(researchEnabled(config())).toBe(false);
    expect(researchEnabled(config({ research: {} }))).toBe(false);
    expect(researchEnabled(config({ research: { enabled: false } }))).toBe(false);
    expect(researchEnabled(config({ research: { enabled: 'true' } }))).toBe(false);
    expect(researchEnabled(config({ research: null }))).toBe(false);
    expect(researchEnabled(config({ research: { enabled: true } }))).toBe(true);
  });

  it('has constraints only when the server says so with a true', () => {
    expect(constraintsEnabled(null)).toBe(false);
    expect(constraintsEnabled(config({ features: {} }))).toBe(false);
    expect(constraintsEnabled(config({ features: { constraints: 1 } }))).toBe(false);
    expect(constraintsEnabled(config({ features: { constraints: true } }))).toBe(true);
  });

  it('draws four of the five signals as the product is built, and the fifth only for a server that has it', () => {
    expect(capabilityFlags(null)).toEqual({
      evidence: true,
      assumptions: true,
      alternatives: true,
      constraints: false,
      approval: true,
    });
    expect(capabilityFlags(config({ features: { constraints: true } })).constraints).toBe(true);
    expect(CAPABILITIES.map((capability) => capability.id)).toEqual([...CAPABILITY_IDS]);
  });
});

describe('the website a person names', () => {
  it.each([
    ['example.org', { kind: 'domain', domain: 'example.org' }],
    ['  Example.ORG  ', { kind: 'domain', domain: 'example.org' }],
    ['https://example.org', { kind: 'domain', domain: 'example.org' }],
    ['https://example.org/', { kind: 'domain', domain: 'example.org' }],
    ['http://www.example.co.uk', { kind: 'domain', domain: 'www.example.co.uk' }],
    ['münchen.de', { kind: 'domain', domain: 'xn--mnchen-3ya.de' }],
  ])('takes %j as a site', (typed, expected) => {
    expect(classifySite(typed)).toEqual(expected);
  });

  it.each([
    ['https://example.org/fees/2025', 'https://example.org/fees/2025', 'example.org'],
    ['example.org/pilot?stage=2', 'https://example.org/pilot?stage=2', 'example.org'],
    ['example.org:8443', 'https://example.org:8443', 'example.org'],
    ['http://example.org/page', 'http://example.org/page', 'example.org'],
  ])('takes %j as one page, and says which', (typed, url, host) => {
    expect(classifySite(typed)).toEqual({ kind: 'url', url, host });
  });

  it('says nothing for an empty field, and says it did not understand what it cannot read as an address', () => {
    expect(classifySite('')).toEqual({ kind: 'none' });
    expect(classifySite('   ')).toEqual({ kind: 'none' });
    for (const typed of [
      'example',
      'not a website',
      'localhost',
      'a.b',
      'example..org',
      '-bad.example.org',
      'ftp://example.org',
      'javascript:alert(1)',
      'https://user:secret@example.org',
      'https://',
      `https://example.org/${'x'.repeat(ADDRESS_MAX)}`,
    ]) {
      expect(classifySite(typed), typed).toEqual({ kind: 'unclear' });
    }
  });
});

describe('what research is asked to do', () => {
  const site = classifySite('example.org');

  it('carries the site, the guidance, the time frame and the place when research is on', () => {
    const intake = researchIntake({
      auto: true,
      site,
      horizon: ' 1 year ',
      geography: 'Northern region',
      guidance: 'Official sources only',
    });
    expect(intake).toEqual({
      auto: true,
      domain: 'example.org',
      guidance: 'Official sources only',
      horizon: '1 year',
      geography: 'Northern region',
    });
    expect(researchIntakeSchema.parse(intake)).toEqual(intake);
    expect(
      researchIntake({
        auto: true,
        site: classifySite('example.org/page'),
        horizon: '',
        geography: '',
        guidance: '',
      }),
    ).toEqual({ auto: true, url: 'https://example.org/page' });
  });

  it('is manual mode when research is off: what is for research goes, and what is about the scenario stays', () => {
    const intake = researchIntake({
      auto: false,
      site,
      horizon: '3 years',
      geography: 'Northern region',
      guidance: 'Official sources only',
    });
    expect(intake).toEqual({ auto: false, horizon: '3 years', geography: 'Northern region' });
    expect(researchIntakeSchema.parse(intake)).toEqual(intake);
  });

  it('keeps every field inside what the server takes', () => {
    const intake = researchIntake({
      auto: true,
      site: { kind: 'none' },
      horizon: 'h'.repeat(500),
      geography: 'g'.repeat(500),
      guidance: 'u'.repeat(GUIDANCE_MAX + 100),
    });
    expect(intake.horizon).toHaveLength(200);
    expect(intake.geography).toHaveLength(200);
    expect(intake.guidance).toHaveLength(GUIDANCE_MAX);
    expect(() => researchIntakeSchema.parse(intake)).not.toThrow();
  });

  it('turns the choice of time frame into its words, and nothing for not saying', () => {
    expect(HORIZONS.map((horizon) => horizon.label)).toEqual([
      'Not sure',
      'Next quarter',
      '6 months',
      '1 year',
      '3 years',
      'Custom',
    ]);
    expect(horizonText('open', 'ignored')).toBe('');
    expect(horizonText('quarter', '')).toBe('Next quarter');
    expect(horizonText('three-years', '')).toBe('3 years');
    expect(horizonText('custom', '  the next two quarters ')).toBe('the next two quarters');
    expect(horizonText('custom', '   ')).toBe('');
  });
});

describe('what the person said becomes part of the scenario they confirm', () => {
  const asked = scenarioFixture({
    geography: null,
    horizon: null,
    ambiguities: [
      { field: 'time horizon', message: 'No period is given.', question: 'Over what time?' },
      { field: 'geography', message: 'No place is given.', question: 'Where?' },
      { field: 'success', message: 'No measure of success.', question: 'How is it judged?' },
    ],
    origin: 'rules',
  });

  it('puts their time frame and place where they belong, answers the questions about them, and keeps the rest', () => {
    const frame = withIntake(asked, {
      horizon: '1 year',
      geography: 'Northern region',
      assumptions: ['Demand stays flat'],
    });
    expect(frame.horizon).toBe('1 year');
    expect(frame.geography).toBe('Northern region');
    expect(frame.ambiguities.map((ambiguity) => ambiguity.field)).toEqual(['success']);
    expect(frame.assumptions[0]).toMatchObject({ text: 'Demand stays flat', origin: 'user' });
    // The reading itself is not made theirs: it says who read it.
    expect(frame.origin).toBe('rules');
  });

  it('adds nothing they did not say', () => {
    const untouched = withIntake(asked, { horizon: '', geography: '  ', assumptions: [] });
    expect(untouched).toBe(asked);
    const placeOnly = withIntake(asked, {
      horizon: '',
      geography: 'Northern region',
      assumptions: [],
    });
    expect(placeOnly.horizon).toBeNull();
    expect(placeOnly.ambiguities.map((ambiguity) => ambiguity.field)).toEqual([
      'time horizon',
      'success',
    ]);
  });
});

describe('a project that is made from a question alone', () => {
  const question = 'What could happen if the harbour office doubles the mooring fee?';
  const input = (documents: CreateProjectInput['documents']): CreateProjectInput => ({
    name: 'Mooring fee',
    question,
    documents,
    workflow: 'guided',
    research: { auto: true },
  });

  it('is refused today for want of a source, as it was before automatic research', () => {
    const refused = validateIntake(input([]), { withoutSources: false });
    expect(refused.error).toMatch(/at least one source/iu);
    expect(refused.data).toBeUndefined();
  });

  it('is taken when research is on: everything else is checked as for any project, and no document is made up', () => {
    const accepted = validateIntake(input([]), { withoutSources: true });
    expect(accepted.error).toBeUndefined();
    expect(accepted.data?.documents).toEqual([]);
    expect(accepted.data?.question).toBe(question);
    expect(accepted.data?.research).toEqual({ auto: true });

    // A question that is too short, or a name that is, is still refused in the same words.
    const short = validateIntake({ ...input([]), question: 'Why?' }, { withoutSources: true });
    expect(short.error).toMatch(/10–2,000 characters/u);
    expect(short.error).not.toMatch(/source/iu);
    const unnamed = validateIntake({ ...input([]), name: 'x' }, { withoutSources: true });
    expect(unnamed.error).toMatch(/project name/iu);
  });

  it('keeps the sources a person did attach', () => {
    const notes = {
      name: 'notes.md',
      content: 'The harbour office sets the fee each spring. '.repeat(3),
    };
    const accepted = validateIntake(input([notes]), { withoutSources: true });
    expect(accepted.data?.documents).toHaveLength(1);
    expect(accepted.data?.documents[0]?.name).toBe('notes.md');
  });
});

describe('the questions to start from', () => {
  it('are sentences with blanks, and no figure and no name of a company or a product', () => {
    expect(TEMPLATES.map((template) => template.label)).toEqual([
      'AI adoption',
      'Pricing change',
      'Product launch',
      'Policy change',
      'Market entry',
      'Operating-model change',
    ]);
    for (const template of TEMPLATES) {
      expect(template.question, template.label).toMatch(/^What could happen if .+\?$/u);
      expect(template.question, template.label).toMatch(/\[[^\]]+\]/u);
      expect(template.question, template.label).not.toMatch(/\d/u);
      expect(template.question, template.label).not.toMatch(
        /microsoft|copilot|azure|teams|amazon|google/iu,
      );
    }
  });

  it('finds the first blank to select, and says which blanks are still there', () => {
    const template = TEMPLATES[1]!.question;
    const [start, end] = firstBlank(template)!;
    expect(template.slice(start, end)).toBe('[a product, service or programme]');
    expect(firstBlank('No blank here.')).toBeNull();

    expect(leftBlank(template, template)).toBe('[a product, service or programme]');
    const half = template.replace('[a product, service or programme]', 'a bus pass');
    expect(leftBlank(half, template)).toBe('[a group of people]');
    expect(leftBlank(half.replace('[a group of people]', 'students'), template)).toBeNull();
    // A different question that happens to have brackets of its own is not the template's.
    expect(leftBlank('What if [sic] happens?', template)).toBeNull();
  });

  it('suggest whole questions from different walks of life, each short enough for one line', () => {
    expect(PROMPTS.length).toBeGreaterThanOrEqual(5);
    for (const prompt of PROMPTS) {
      expect(prompt.length, prompt).toBeLessThanOrEqual(70);
      expect(prompt, prompt).not.toMatch(/\[|\d/u);
    }
  });
});

describe('what the first screen says', () => {
  const words = (text: string): number => text.split(/\s+/u).filter(Boolean).length;
  const HERO = [
    'See how a decision could unfold.',
    'Swarm researches the context, maps who matters, simulates reactions, and shows possible paths forward.',
  ];

  it('keeps the hero to a few words', () => {
    expect(HERO.reduce((sum, line) => sum + words(line), 0)).toBeLessThanOrEqual(25);
  });

  it('claims no prediction and no figure about the world, in any of it', () => {
    const said = [
      ...HERO,
      'Explore scenarios, not predictions.',
      ...CAPABILITIES.flatMap((capability) => [capability.label, capability.detail]),
      ...TEMPLATES.flatMap((template) => [template.label, template.question]),
      ...PROMPTS,
      ...HORIZONS.map((horizon) => horizon.label),
      ...[true, false].flatMap((research) =>
        [true, false].flatMap((constraints) =>
          flowSteps({ research, constraints }).flatMap((step) => [
            step.name,
            `Swarm ${step.swarm}`,
            `You ${step.you}`,
          ]),
        ),
      ),
      'Swarm finds and reads public sources for you.',
      'Manual sources only: Swarm reads what you add.',
      'Off on this server. Attach your own sources.',
      'Used to rank what research reads, never as an instruction to it.',
      'That does not look like a website yet. Try example.org, or the address of one page.',
      'Automatic research is on. After you continue, Swarm looks for public sources, starting from example.org, and lists every page it reads.',
    ];
    expect(said.flatMap(claimsAgainst)).toEqual([]);
    expect(said.join(' ')).not.toMatch(/\bwill\b|\bforecast|\bpredict(?:s|ed)?\b/iu);
  });

  it('tells each step in the order a decision is made, and only what this server can do', () => {
    const plain = flowSteps({ research: false, constraints: false });
    expect(plain.map((step) => step.name)).toEqual([
      'Question',
      'Research',
      'People',
      'Possible futures',
      'Decision',
    ]);
    const full = flowSteps({ research: true, constraints: true });
    expect(full.map((step) => step.name)).toEqual([
      'Question',
      'Research',
      'People and constraints',
      'Possible futures',
      'Decision',
    ]);
    expect(plain[1]!.swarm).toMatch(/files and pages you add/u);
    expect(plain[1]!.swarm).not.toMatch(/public sources/u);
    expect(full[1]!.swarm).toMatch(/public sources/u);
    expect(plain[2]!.swarm).not.toMatch(/constrain/u);
    expect(full[2]!.swarm).toMatch(/constrains the decision/u);
    // The person is in control of every step that leads to the result, and nothing acts for them.
    expect(full[4]!.you).toMatch(/never contacts anyone or acts for you/u);
  });
});
