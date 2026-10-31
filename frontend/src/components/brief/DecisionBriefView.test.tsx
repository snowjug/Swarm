import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  BRIEF_READING_NOTES,
  BRIEF_SECTION_IDS,
  BRIEF_SECTION_TITLES,
  BRIEF_SIGNAL_NOTICES,
  NO_DIFFERENCE_NOTICE,
  STATEMENT_ORIGINS,
  type BriefSignal,
} from '../../../../shared/brief';
import { NO_DIRECTION_NOTICE } from '../../../../shared/signal';
import type { BriefHandle } from '../../hooks/useBrief';
import {
  GENERATED_AT,
  NOT_TOLD,
  briefFixture,
  viewFixture,
  visualsFixture,
} from '../../test/brief';
import { projectFixture } from '../../test/project';
import { visibleText } from '../../test/provider';
import { BriefDocument } from './BriefDocument';
import { BriefPanel, DecisionBriefView } from './DecisionBriefView';

const mocked = vi.hoisted(() => ({ handle: null as unknown as BriefHandle }));
vi.mock('../../hooks/useBrief', () => ({ useBrief: () => mocked.handle }));

const noop = async (): Promise<void> => undefined;
const handle = (overrides: Partial<BriefHandle> = {}): BriefHandle => ({
  view: null,
  loading: false,
  error: null,
  generating: false,
  generateError: null,
  generate: noop,
  reload: () => undefined,
  ...overrides,
});

const PROJECT = projectFixture().id;
const panel = (overrides: Partial<BriefHandle> = {}, onNavigate?: () => void) =>
  renderToStaticMarkup(
    <BriefPanel projectId={PROJECT} handle={handle(overrides)} onNavigate={onNavigate} />,
  );
const document = (view = viewFixture(), generating = false) =>
  renderToStaticMarkup(
    <BriefDocument
      projectId={PROJECT}
      view={{ ...view, brief: view.brief! }}
      generating={generating}
      onGenerate={() => undefined}
    />,
  );
const buttons = (html: string) =>
  [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/gu)].map((match) => ({
    attrs: match[1] ?? '',
    text: visibleText(match[2] ?? ''),
  }));
const tags = (html: string, name: string) =>
  [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)</${name}>`, 'gu'))].map(
    (match) => ({
      attrs: match[1] ?? '',
      text: visibleText(match[2] ?? ''),
    }),
  );

describe('the states of the decision brief', () => {
  it('says that it is loading, and offers nothing else yet', () => {
    const html = panel({ loading: true });
    expect(visibleText(html)).toContain('Loading the decision brief');
    expect(buttons(html)).toEqual([]);
  });

  it('shows a failed load as an alert with a way to try again, and never an empty page', () => {
    const html = panel({ error: 'Cannot reach the local server.' });
    expect(html).toContain('role="alert"');
    expect(visibleText(html)).toContain('The decision brief could not be loaded');
    expect(visibleText(html)).toContain('Cannot reach the local server.');
    expect(buttons(html).map((entry) => entry.text)).toEqual(['Try again']);
  });

  it('explains that there is no analysis yet, and sends the person to the Simulation stage', () => {
    const view = viewFixture({ brief: null, visuals: null, latestAnalysis: null });
    const html = panel({ view }, () => undefined);
    const text = visibleText(html);
    expect(text).toContain('No decision brief yet');
    expect(text).toContain('There is no finished analysis in this project yet');
    expect(text).toContain('Run the analysis in the Simulation stage');
    expect(buttons(html).map((entry) => entry.text)).toEqual(['Open the Simulation stage']);
    // Without a way to move, it still explains and invents no link.
    expect(buttons(panel({ view }))).toEqual([]);
    expect(text).not.toContain('Generate decision brief');
  });

  it('offers to generate the brief when there is a finished analysis, and says what it is and is not', () => {
    const view = viewFixture({ brief: null, visuals: null });
    const html = panel({ view });
    const text = visibleText(html);
    expect(buttons(html).map((entry) => entry.text)).toEqual(['Generate decision brief']);
    expect(text).toContain('The analysis finished');
    expect(text).toContain('assembled by rules from this project’s own data');
    expect(text).toContain('No model writes any of it');
    expect(html).not.toContain('disabled=""');
  });

  it('disables the button while it works, and shows a failed generation with a way to try again', () => {
    const view = viewFixture({ brief: null, visuals: null });
    const busy = panel({ view, generating: true });
    expect(busy).toContain('disabled=""');
    expect(visibleText(busy)).toContain('Generating the brief');
    const failed = panel({
      view,
      generateError: 'There is no completed analysis to write a brief from.',
    });
    expect(failed).toContain('role="alert"');
    expect(visibleText(failed)).toContain('The brief could not be made');
    expect(buttons(failed).map((entry) => entry.text)).toEqual([
      'Try again',
      'Generate decision brief',
    ]);
  });

  it('tells a person who may only read that someone else has to generate it', () => {
    const view = viewFixture({
      brief: null,
      visuals: null,
      may: { generate: false, export: true },
    });
    const html = panel({ view });
    expect(buttons(html)).toEqual([]);
    expect(visibleText(html)).toContain('Your role on this experiment cannot make the brief');
  });

  it('shows the brief, with a failed regeneration above it, once there is one', () => {
    const html = panel({ view: viewFixture(), generateError: 'The analysis changed.' });
    expect(html).toContain('<article class="brief"');
    expect(visibleText(html)).toContain('The brief could not be made');
    expect(visibleText(html)).toContain('Decision brief');
  });

  it('is mounted by the view of a project, which asks the hook for that project', () => {
    mocked.handle = handle({ view: viewFixture() });
    const html = renderToStaticMarkup(<DecisionBriefView project={projectFixture()} />);
    expect(html).toContain('<article class="brief"');
    expect(html).toContain(`/api/projects/${PROJECT}/brief/export?format=md`);
  });
});

describe('the answer first', () => {
  const html = document();
  const text = visibleText(html);

  it('puts the executive answer ahead of everything else, with its origin, reliance and fidelity', () => {
    expect(html.indexOf('id="brief-executive-answer"')).toBeLessThan(
      html.indexOf('id="brief-decision"'),
    );
    const card = html.slice(
      html.indexOf('id="brief-executive-answer"'),
      html.indexOf('id="brief-decision"'),
    );
    const cardText = visibleText(card);
    expect(cardText).toContain(briefFixture().headline);
    expect(cardText).toContain('Simulation aggregation');
    expect(cardText).toContain('Moderate reliance');
    expect(cardText).toContain('Produced by: Rules: outcomes follow from the declared assumptions');
    expect(cardText).toContain('1 open critique');
  });

  it('carries a line that says what the answer does not tell you', () => {
    const line = /<p class="brief-not-told">([\s\S]*?)<\/p>/u.exec(html);
    expect(visibleText(line?.[1] ?? '')).toBe(NOT_TOLD);
  });

  it('says how the brief was made, and that it explores scenarios and predicts nothing', () => {
    expect(text).toContain(
      'Assembled by rules from this project’s analysis, stakeholders, scenario and sources',
    );
    expect(text).toContain('It does not predict the future');
    expect(text).toContain(
      '10 seeded runs for each of 2 variants over 8 rounds, from base seed 100',
    );
  });

  it('shows how to read the labels: every origin and every level of reliance', () => {
    const legend = html.slice(
      html.indexOf('class="brief-legend-box"'),
      html.indexOf('class="brief-nav"'),
    );
    const legendText = visibleText(legend);
    for (const label of [
      'Supplied evidence',
      'Retrieved public evidence',
      'User assumption',
      'System assumption',
      'Inferred stakeholder',
      'Actor behaviour',
      'Simulation aggregation',
      'Model interpretation',
      'Historical comparison',
      'Unresolved uncertainty',
      'High reliance',
      'Moderate reliance',
      'Low reliance',
    ]) {
      expect(legendText, label).toContain(label);
    }
    expect(legendText).toContain('They are not probabilities');
    expect(STATEMENT_ORIGINS).toHaveLength(10);
  });
});

describe('the sections', () => {
  const html = document();

  it('lists the seventeen sections in a navigation, in the order they are read, each a link to its section', () => {
    const nav =
      /<nav class="brief-nav" aria-label="Sections of the decision brief">([\s\S]*?)<\/nav>/u.exec(
        html,
      );
    expect(nav).not.toBeNull();
    const links = [...(nav?.[1] ?? '').matchAll(/<a href="#([^"]+)">([\s\S]*?)<\/a>/gu)];
    expect(links.map((link) => link[1])).toEqual(BRIEF_SECTION_IDS.map((id) => `brief-${id}`));
    expect(links.map((link) => visibleText(link[2] ?? ''))).toEqual(
      BRIEF_SECTION_IDS.map((id, index) => `${index + 1} ${BRIEF_SECTION_TITLES[id]}`),
    );
    for (const id of BRIEF_SECTION_IDS) expect(html).toContain(`id="brief-${id}"`);
  });

  it('numbers the sections, and gives each a heading that names it', () => {
    const headings = tags(html, 'h4').map((entry) => entry.text);
    expect(headings[0]).toBe('Executive answer');
    expect(headings[1]).toBe('2. Decision evaluated');
    expect(headings).toHaveLength(17);
    expect(headings.at(-1)).toBe('17. Technical appendix');
    expect(tags(html, 'h3').map((entry) => entry.text)).toEqual(['Decision brief']);
  });

  it('labels every statement with where it comes from, and how far to rely on it where that applies', () => {
    expect(html).toContain('brief-origin brief-origin-inferred-stakeholder');
    expect(html).toContain('brief-origin brief-origin-system-assumption');
    expect(html).toContain('brief-origin brief-origin-user-assumption');
    expect(html).toContain('brief-origin brief-origin-unresolved-uncertainty');
    expect(html).toContain('brief-reliance brief-reliance-moderate');
    // The label is words and a glyph, never colour alone.
    for (const origin of html.matchAll(
      /<span class="brief-origin [^"]*"[^>]*>([\s\S]*?)<\/span>/gu,
    )) {
      expect(visibleText(origin[1] ?? '').length).toBeGreaterThan(5);
      expect(origin[1]).toContain('aria-hidden="true"');
    }
  });

  it('opens what a statement rests on: the passage with its id and quotation, the finding’s stability, the assumption', () => {
    const stakeholder = html.slice(
      html.indexOf('id="statement-stakeholders-1"'),
      html.indexOf('id="brief-reaction-patterns"'),
    );
    const text = visibleText(stakeholder);
    expect(text).toContain('What this rests on (2)');
    expect(text).toContain('Passage that supports P1 in Supplied notes.md');
    expect(stakeholder).toContain(
      '<q>Members of the group described how they react to a change of this kind.</q>',
    );
    expect(stakeholder).toContain('<code>P1</code>');
    expect(text).toContain('Stakeholder Subscribers');
    const answer = visibleText(
      html.slice(
        html.indexOf('id="statement-executive-answer-1"'),
        html.indexOf('id="statement-executive-answer-2"'),
      ),
    );
    expect(answer).toContain('Finding f1');
    expect(answer).toContain(
      'Held in 10 of 10 seeded runs (interval 0.72 to 1.00; mostly repeatable)',
    );
    expect(answer).toContain('Seeded runs of Proposed change');
    const assumption = visibleText(
      html.slice(
        html.indexOf('id="statement-assumptions-1"'),
        html.indexOf('id="statement-assumptions-2"'),
      ),
    );
    expect(assumption).toContain('Sensitivity s1');
    expect(assumption).toContain('shift -0.18 (standard error 0.01)');
    expect(assumption).toContain('Assumption “Subscribers”: switching cost is set at 0.40');
    expect(html).toMatch(/<details class="brief-refs"><summary>What this rests on/u);
  });

  it('keeps a statement that rests on nothing free of an empty disclosure', () => {
    const view = viewFixture();
    view.brief!.sections[1]!.statements = [
      {
        id: 'decision-1',
        origin: 'unresolved-uncertainty',
        text: 'Nothing is known here.',
        refs: {
          evidence: [],
          stakeholderIds: [],
          findingIds: [],
          sensitivityIds: [],
          critiqueIds: [],
          assumptions: [],
          documentIds: [],
          variantIds: [],
        },
        reliance: null,
      },
    ];
    const bare = document(view);
    const statement = bare.slice(
      bare.indexOf('id="statement-decision-1"'),
      bare.indexOf('id="brief-evidence-base"'),
    );
    expect(visibleText(statement)).toContain('Nothing is known here.');
    expect(statement).not.toContain('<details');
  });

  it('shows the recommendations in a table with everything needed to act on them, and not twice', () => {
    const section = html.slice(
      html.indexOf('id="brief-recommendations"'),
      html.indexOf('id="brief-validation-plan"'),
    );
    expect(visibleText(section)).toContain(
      'Recommendations are ordered by impact times repeatability divided by effort',
    );
    const table =
      /<table class="brief-table brief-recommendations">([\s\S]*?)<\/table>/u.exec(section)?.[1] ??
      '';
    expect(tags(table, 'caption')[0]?.text).toBe('Recommendations, best first');
    expect(
      tags(table, 'th')
        .slice(0, 8)
        .map((entry) => entry.text),
    ).toEqual([
      'Priority',
      'Recommendation',
      'Impact',
      'Effort',
      'Reversibility',
      'Owner',
      'Leading indicators',
      'How to check it first',
    ]);
    expect(table.match(/<tr>/gu)).toHaveLength(3);
    const rows = tags(table, 'tr');
    expect(rows[1]?.text).toContain('Mitigate or stage the change for “Subscribers”');
    expect(rows[1]?.text).toContain('Simulation aggregation High reliance');
    expect(rows[1]?.text).toContain('Horizon: Before committing, then through a staged rollout');
    expect(rows[1]?.text).toContain('High Medium Easy Finance');
    expect(rows[1]?.text).toContain('Members of the affected group who ask to change or leave.');
    expect(rows[1]?.text).toContain(
      'Stage the change with a small group and compare their reaction.',
    );
    expect(rows[2]?.text).toContain('Research and analytics');
    expect(rows[2]?.text).toContain('Low reliance');
    // The row headers are the priorities.
    expect(table).toContain('<th scope="row">1</th>');
    expect(table).toContain('<th scope="row">2</th>');
    // The recommendations are not listed a second time among the statements.
    expect((section.match(/Mitigate or stage the change for/gu) ?? []).length).toBe(1);
  });

  it('shows the validation plan as a table of checks, none of which has been run', () => {
    const section = html.slice(
      html.indexOf('id="brief-validation-plan"'),
      html.indexOf('id="brief-sources"'),
    );
    expect(visibleText(section)).toContain('None has been run');
    expect(tags(section, 'caption')[0]?.text).toBe(
      'Validation plan: real-world checks, none of which has been run',
    );
    expect(visibleText(section)).toContain(
      'How long and how costly is it for “Subscribers” to change?',
    );
    expect(visibleText(section)).toContain('2 to 4 weeks');
    expect(visibleText(section)).toContain(
      'sensitivity s1: Subscribers: cost of switching, 0.2 higher',
    );
    expect((section.match(/How long and how costly is it/gu) ?? []).length).toBe(1);
  });

  it('keeps the limitations as statements of their own', () => {
    expect(visibleText(html.slice(html.indexOf('id="brief-limitations"')))).toContain(
      'A simulated statement in limitations',
    );
    expect(briefFixture().limitations[0]).toContain('Synthetic actors are not real people');
  });
});

describe('the charts', () => {
  const html = document();
  const between = (from: string, to: string) => html.slice(html.indexOf(from), html.indexOf(to));

  it('draws a stakeholder map by category, with a table for the same data', () => {
    const section = between('id="brief-stakeholders"', 'id="brief-reaction-patterns"');
    expect(tags(section, 'figcaption')[0]?.text).toBe('Stakeholder map by category');
    expect(section).toContain('aria-label="Bears cost"');
    expect(section).toContain('aria-label="Competitor"');
    expect(visibleText(section)).toContain('Harmed by the change');
    expect(visibleText(section)).toContain('1 cited passage supports it');
    expect(visibleText(section)).toContain('Effect unclear');
    expect(section).toMatch(
      /<details class="brief-table-alt"><summary>Show this as a table<\/summary>/u,
    );
    expect(visibleText(section)).toContain('Stakeholder map, as a table');
  });

  it('draws where simulated members ended up for every variant, labelled, with a legend and a table', () => {
    const section = between('id="brief-reaction-patterns"', 'id="brief-alternative-outcomes"');
    const bars = [
      ...section.matchAll(/<div class="brief-bar" role="img" aria-label="([^"]+)"/gu),
    ].map((match) => match[1]);
    expect(bars).toHaveLength(2);
    expect(bars[0]).toBe(
      'No change: Go along 3.9, Accept with conditions 7.8, Wait and see 16, Adapt to limit the impact 12, Look for an alternative 2.3, Resist 1.6',
    );
    expect(bars[1]).toContain('Look for an alternative 11, Resist 7.6');
    expect((section.match(/class="brief-seg brief-seg-/gu) ?? []).length).toBe(12);
    const legend = /<ul class="brief-legend">([\s\S]*?)<\/ul>/u.exec(section)?.[1] ?? '';
    expect(tags(legend, 'li').map((entry) => entry.text)).toEqual([
      'Go along',
      'Accept with conditions',
      'Wait and see',
      'Adapt to limit the impact',
      'Look for an alternative',
      'Resist',
    ]);
    expect(visibleText(section)).toContain(
      'counts of simulated members, not shares of a real population',
    );
    expect(visibleText(section)).toContain('Mean number of simulated members in each response');
    expect(visibleText(section)).toContain('19 (17 to 21)');
  });

  it('draws the comparison with the baseline on the same seeds, with the finding and its stability', () => {
    const section = between('id="brief-alternative-outcomes"', 'id="brief-first-order"');
    expect(section).toContain(
      'aria-label="No change: about 3.9 of 43 simulated members looking for an alternative or resisting"',
    );
    expect(section).toContain(
      'aria-label="Proposed change: about 19 of 43 simulated members looking for an alternative or resisting"',
    );
    const text = visibleText(section);
    expect(text).toContain(
      'On the same seeds, the change left 15 more simulated members adverse, with more in 10 of 10 paired runs.',
    );
    expect(text).toContain('Finding f1 holds in 10 of 10 seeded runs (mostly repeatable).');
    expect(text).toContain('Each alternative against the baseline');
  });

  it('draws sensitivity bars that name the assumption, the shift, its origin and whether anything backs it', () => {
    const section = between('id="brief-uncertainty"', 'id="brief-risks-opportunities"');
    expect(section).toContain(
      'aria-label="Subscribers: cost of switching, 0.2 higher: shift -0.18 in Share ending in switch or resist"',
    );
    expect(section).toContain('brief-diverge-bar brief-diverge-neg');
    expect(section).toContain('brief-diverge-bar brief-diverge-pos');
    const text = visibleText(section);
    expect(text).toContain('Sensitive to this assumption');
    expect(text).toContain('Inconclusive');
    expect(text).toContain('No cited passage backs it');
    expect(text).toContain('A cited passage backs it');
    expect(text).toContain('System assumption');
    expect(text).toContain('Sensitivity of the simulated outcome to each assumption moved');
  });

  it('lists the assumption register and the evidence map as tables with captions and row headers', () => {
    const register = between('id="brief-assumptions"', 'id="brief-uncertainty"');
    expect(tags(register, 'caption')[0]?.text).toBe(
      'Assumption register: what the simulated result rests on',
    );
    expect(
      tags(register, 'th')
        .slice(0, 5)
        .map((entry) => entry.text),
    ).toEqual(['Assumption', 'Origin', 'Sensitive', 'Evidenced', 'Effect of moving it']);
    expect(visibleText(register)).toContain('Not moved');
    expect(register).toContain('<th scope="row">');
    const evidence = between('id="brief-evidence-base"', 'id="brief-stakeholders"');
    expect(tags(evidence, 'caption')[0]?.text).toBe(
      'Evidence map: cited passages for each stakeholder',
    );
    expect(visibleText(evidence)).toContain('Rival provider 0 0 none No cited support');
    expect(visibleText(evidence)).toContain('Subscribers 1 0 Supplied notes.md');
  });

  it('gives every chart a caption, an accessible name, and a table for the same data', () => {
    expect(tags(html, 'figure')).toHaveLength(4);
    expect(tags(html, 'figcaption')).toHaveLength(4);
    expect((html.match(/<details class="brief-table-alt">/gu) ?? []).length).toBe(4);
    expect((html.match(/role="img"/gu) ?? []).length).toBe(6);
    for (const image of html.matchAll(/role="img" aria-label="([^"]*)"/gu)) {
      expect(image[1]?.length).toBeGreaterThan(10);
    }
    for (const region of html.matchAll(
      /<div class="brief-scroll" role="region" aria-label="([^"]*)" tabindex="0">/gu,
    )) {
      expect(region[1]?.length).toBeGreaterThan(5);
    }
    for (const table of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gu)) {
      expect(table[1]).toContain('<caption>');
      expect(table[1]).toContain('scope="col"');
    }
  });

  it('says that the charts are not shown, and shows the statements all the same, when the analysis is gone', () => {
    const view = viewFixture({ visuals: null });
    const bare = document(view);
    expect(visibleText(bare)).toContain(
      'The charts for this section are not shown, because the analysis they are drawn from is no longer stored.',
    );
    expect(bare).not.toContain('role="img"');
    expect(visibleText(bare)).toContain('Mitigate or stage the change for “Subscribers”');
    expect(bare).toContain('Passage that supports');
  });

  it('says when there is no alternative to compare, and no assumption that was moved', () => {
    const view = viewFixture({
      visuals: visualsFixture({ scenarioComparison: [], sensitivity: [] }),
    });
    const text = visibleText(document(view));
    expect(text).toContain('There is no alternative to compare with a baseline in this analysis.');
    expect(text).toContain(
      'No assumption was moved in this analysis, so there is no sensitivity chart.',
    );
  });
});

describe('exports and staleness', () => {
  it('offers Markdown, JSON and a printable page, which opens apart and cannot reach the app', () => {
    const html = document();
    const links = [
      ...html.matchAll(
        /<a class="button button-secondary button-small" href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/gu,
      ),
    ].map((match) => ({
      href: match[1],
      attrs: match[2] ?? '',
      text: visibleText(match[3] ?? ''),
    }));
    expect(links.map((link) => link.text)).toEqual(['Markdown', 'JSON', 'Printable']);
    expect(links.map((link) => link.href)).toEqual([
      `/api/projects/${PROJECT}/brief/export?format=md`,
      `/api/projects/${PROJECT}/brief/export?format=json`,
      `/api/projects/${PROJECT}/brief/export?format=html`,
    ]);
    expect(links[0]?.attrs).toContain('download');
    expect(links[1]?.attrs).toContain('download');
    expect(links[2]?.attrs).toContain('target="_blank"');
    expect(links[2]?.attrs).toContain('rel="noopener noreferrer"');
  });

  it('offers to generate again to someone who may, and hides what a person may not do', () => {
    expect(buttons(document()).map((entry) => entry.text)).toContain('Generate again');
    const reader = document(viewFixture({ may: { generate: false, export: true } }));
    expect(buttons(reader).map((entry) => entry.text)).not.toContain('Generate again');
    const nothing = document(viewFixture({ may: { generate: false, export: false } }));
    expect(nothing).not.toContain('format=md');
    expect(buttons(nothing)).toEqual([]);
    expect(
      buttons(document(viewFixture(), true)).find((entry) => entry.text.includes('Generate again'))
        ?.attrs,
    ).toContain('disabled=""');
  });

  it('warns when something the brief was made from has changed, and says what to do', () => {
    const stale = document(
      viewFixture({ changedSince: ['stakeholders', 'a newer analysis exists'] }),
    );
    const text = visibleText(stale);
    expect(text).toContain('This brief may be out of date');
    expect(text).toContain(
      'Since it was made, this has changed: stakeholders, a newer analysis exists.',
    );
    expect(text).toContain('Generate it again to bring it up to date.');
    const reader = visibleText(
      document(viewFixture({ changedSince: ['actors'], may: { generate: false, export: true } })),
    );
    expect(reader).toContain('Ask someone who can edit the project to generate it again.');
    expect(visibleText(document())).not.toContain('may be out of date');
  });

  it('prints the time it was made in a form a machine can read', () => {
    expect(document()).toContain(`<time dateTime="${GENERATED_AT}">`);
  });
});

describe('text a person or a source wrote stays text', () => {
  const hostile = `<script>alert('x')</script> <img src=x onerror=alert(1)> [click](javascript:alert(2))`;

  it('escapes it in statements, charts, tables and references', () => {
    const view = viewFixture();
    view.brief!.headline = hostile;
    view.brief!.sections[1]!.statements[0]!.text = hostile;
    view.brief!.sections[3]!.statements[0]!.refs.evidence[0]!.quote = hostile;
    view.brief!.recommendations[0]!.text = hostile;
    view.brief!.validationPlan[0]!.question = hostile;
    view.visuals!.stakeholderMap[0]!.stakeholders[0]!.name = hostile;
    view.visuals!.outcomeDistribution[0]!.label = hostile;
    view.visuals!.sensitivity[0]!.label = hostile;
    view.visuals!.assumptionRegister[0]!.text = hostile;
    view.visuals!.evidenceMap[0]!.documents = [hostile];
    const html = document(view);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toMatch(/<a [^>]*javascript:/u);
    expect(html).toContain('&lt;script&gt;alert(&#x27;x&#x27;)&lt;/script&gt;');
  });

  it('uses no raw-markup sink: the markup comes only from the components’ own elements', () => {
    expect(document()).not.toMatch(/dangerouslySetInnerHTML/u);
  });
});

describe('when the comparison cannot be read as a result', () => {
  const withSignal = (signal: BriefSignal) => viewFixture({ brief: briefFixture({ signal }) });
  const comparison = (html: string) =>
    html.slice(html.indexOf('Each alternative against the baseline, on the same seeds'));

  it('adds nothing when the comparison can be read', () => {
    const html = document();
    const text = visibleText(html);
    expect(text).not.toContain(BRIEF_SIGNAL_NOTICES['no-direction'].title);
    expect(text).not.toContain(BRIEF_SIGNAL_NOTICES['no-difference'].title);
    expect(html).not.toContain('brief-reading-note');
    expect(html).not.toContain('notice-warning');
    expect(html).not.toContain('notice-info');
    expect(visibleText(comparison(html))).toContain('On the same seeds, the change left');
  });

  it('says first, in a notice above the executive answer, that the simulation could not tell the change from no change', () => {
    const html = document(withSignal('no-direction'));
    expect(html).toContain('<div class="notice notice-warning" role="status">');
    expect(visibleText(html)).toContain(
      `The simulation could not tell the change from no change ${NO_DIRECTION_NOTICE}`,
    );
    expect(html.indexOf('notice notice-warning')).toBeGreaterThan(html.indexOf('</header>'));
    expect(html.indexOf('notice notice-warning')).toBeLessThan(
      html.indexOf('class="brief-answer"'),
    );
  });

  it('says first, in a notice of its own kind, that there is no measurable difference under these assumptions', () => {
    const html = document(withSignal('no-difference'));
    expect(html).toContain('<div class="notice notice-info" role="status">');
    expect(visibleText(html)).toContain(
      `No measurable difference under these assumptions ${NO_DIFFERENCE_NOTICE}`,
    );
    expect(html.indexOf('notice notice-info')).toBeLessThan(html.indexOf('class="brief-answer"'));
    expect(html).not.toContain('notice-warning');
  });

  it('keeps it apart from the warning that a brief is out of date, and shows both', () => {
    const html = document(
      viewFixture({ brief: briefFixture({ signal: 'no-direction' }), changedSince: ['actors'] }),
    );
    expect(html.match(/class="notice notice-warning"/gu)).toHaveLength(2);
    expect(visibleText(html)).toContain('This brief may be out of date');
  });

  it.each(['no-direction', 'no-difference'] as const)(
    'does not read the chart that sets variants side by side as an effect when it is %s',
    (signal) => {
      const html = comparison(document(withSignal(signal)));
      const text = visibleText(html);
      expect(text).toContain(BRIEF_READING_NOTES[signal]);
      expect(html).toContain('class="field-help brief-reading-note"');
      expect(text).toContain(
        'The comparison with the baseline is not read as an effect of the change.',
      );
      expect(text).not.toContain('On the same seeds, the change left');
      expect(text).not.toMatch(/against about \d+(?:\.\d+)? under the baseline/u);
      // The numbers are still there, in the table, for anyone who wants them.
      expect(text).toContain('Mean adverse simulated members');
    },
  );
});

describe('what the page says about itself', () => {
  it('predicts nothing, promises nothing and quotes no percentage of real people', () => {
    const text =
      visibleText(document()) +
      visibleText(panel({ view: viewFixture({ brief: null, visuals: null }) })) +
      visibleText(document(viewFixture({ brief: briefFixture({ signal: 'no-direction' }) }))) +
      visibleText(document(viewFixture({ brief: briefFixture({ signal: 'no-difference' }) })));
    expect(text).not.toMatch(/\bwill\b/iu);
    expect(text).not.toMatch(/\b(?:certainly|guarantee[ds]?|proves?|proven)\b/iu);
    expect(text).not.toMatch(/\d\s?%/u);
  });

  it('has one level-three heading, level-four headings for sections, and no heading skipped', () => {
    const html = document();
    const levels = [...html.matchAll(/<h([1-6])\b/gu)].map((match) => Number(match[1]));
    expect(levels.filter((level) => level === 3)).toHaveLength(1);
    expect(levels.filter((level) => level < 3)).toEqual([]);
    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index]! - levels[index - 1]!).toBeLessThanOrEqual(1);
    }
  });
});
