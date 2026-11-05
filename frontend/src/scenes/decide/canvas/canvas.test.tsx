import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { claimsAgainst } from '../../../../../e2e/support/claims';
import { COMPARISON_INPUTS_UNRECORDED } from '../../../../../shared/analysis';
import {
  DECISION_STATUSES,
  DECISION_STATUS_INFO,
  EPISTEMIC_LABELS,
  EPISTEMIC_LABEL_INFO,
  SCOPE_DOMAIN_WORDS,
  SCOPE_NOTICE,
  type DecisionView,
} from '../../../../../shared/decision';
import { TooltipProvider } from '../../../design/ui';
import type { DecisionHandle } from '../../../hooks/useDecision';
import {
  canvasFixture,
  constraintRow,
  emptyFixture,
  richFixture,
  scopeFixture,
  scopedFixture,
  statusFixture,
  viewFixture,
} from '../../../test/decision';
import { ReportBridge } from './Bridge';
import { DecisionCanvasView } from './Canvas';
import { Detail } from './Detail';
import {
  COPY,
  GLANCE,
  ITEMS,
  assumptionGlance,
  assumptionsOf,
  changeWords,
  checksOf,
  completenessOf,
  constraintGlance,
  explorationOf,
  futureItems,
  gateWords,
  gistOf,
  moveWords,
  noticesOf,
  roleName,
  sensitivityWords,
  stateOf,
  strip,
  viewWords,
} from './model';

const noop = () => undefined;
const go = { ask: noop, ground: noop, map: noop, simulate: noop };

const handleOf = (
  view: DecisionView | null,
  extra: Partial<DecisionHandle> = {},
): DecisionHandle => ({
  view,
  loading: false,
  refreshing: false,
  error: null,
  reload: noop,
  ...extra,
});

const render = (handle: DecisionHandle, options: { below?: boolean; detailed?: boolean } = {}) =>
  renderToStaticMarkup(
    <TooltipProvider>
      <DecisionCanvasView
        handle={handle}
        go={go}
        below={options.below ?? true}
        onDetailed={options.detailed ? noop : null}
      />
    </TooltipProvider>,
  );

const text = (markup: string): string =>
  markup
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"')
    .replace(/&#x27;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/\s+/gu, ' ');

describe('the first viewport of the decision canvas', () => {
  it.each(DECISION_STATUSES)('shows the ten things in order, answer first, for %s', (status) => {
    const markup = render(handleOf(viewFixture(statusFixture(status))));
    const items = [...markup.matchAll(/data-canvas-item="([a-z]+)"/gu)].map((match) => match[1]);
    expect(items).toEqual([...ITEMS]);
    expect(ITEMS.slice(0, 2)).toEqual(['question', 'answer']);
  });

  it.each(DECISION_STATUSES)('says the status in words, and what it means, for %s', (status) => {
    const said = text(render(handleOf(viewFixture(statusFixture(status)))));
    expect(said).toContain(DECISION_STATUS_INFO[status].label);
    expect(said).toContain(DECISION_STATUS_INFO[status].meaning);
    expect(said).toContain(COPY.notice);
  });

  it('has one level-one heading, and a level-two heading for each of the ten', () => {
    const markup = render(handleOf(viewFixture()));
    expect(markup.match(/<h1[ >]/gu)).toHaveLength(1);
    const names = [...markup.matchAll(/<h2[^>]*id="canvas-([a-z]+)"/gu)].map((match) => match[1]);
    expect(names).toEqual([...ITEMS]);
  });

  it('gives the critical assumptions an item of their own, from what the recommendation rests on, and not under what could change the result', () => {
    const canvas = canvasFixture((raw) => {
      raw.answer.recommendation.assumptions.items = [
        { text: 'The answer depends on switching cost.', label: 'model-inference', basis: 'a' },
        { text: 'Subscribers stay for a year.', label: 'assumption', basis: 'b' },
        { text: 'A third assumption that is only in full.', label: 'assumption', basis: 'c' },
      ] as never;
      raw.changes.assumptions = [
        {
          id: 'strength',
          statement: { text: 'The result is sensitive to switching cost.', label: 'assumption' },
          origin: 'system-assumption',
          classification: 'assumption-sensitive',
          shift: 0.18,
          standardError: 0.01,
          flipsAnswer: true,
          evidenced: false,
        },
      ];
    });
    const markup = render(handleOf(viewFixture(canvas)));
    const item = (id: string) =>
      markup.split(`data-canvas-item="${id}"`)[1]!.split('data-canvas-item=')[0]!;
    const assumptions = text(item('assumptions'));
    expect(assumptions).toContain('Critical assumptions');
    expect(assumptions).toContain('The answer depends on switching cost.');
    expect(assumptions).toContain('Subscribers stay for a year.');
    // Two at a glance; the rest are said to be in full.
    expect(assumptions).not.toContain('A third assumption that is only in full.');
    expect(assumptions).toContain('1 more assumption in full');
    expect(assumptions).toContain('1 could reverse the answer');
    // What could change the result is about views and what else was tried, and no longer lists assumptions.
    const changes = text(item('changes'));
    expect(changes).not.toContain('The answer depends on switching cost.');
    expect(changes).not.toContain('Subscribers stay for a year.');
  });

  it('says that no assumption is recorded when none is, and counts what is there', () => {
    const none = canvasFixture((raw) => {
      raw.answer.recommendation.assumptions.items = [];
      raw.answer.recommendation.assumptions.missing = 'No assumption is recorded for this result.';
    });
    expect(assumptionsOf(none)).toMatchObject({ total: 0, more: 0, lines: [] });
    expect(gistOf('assumptions', none)).toBe('None recorded');
    expect(text(render(handleOf(viewFixture(none))))).toContain(
      'No assumption is recorded for this result.',
    );
    const some = canvasFixture((raw) => {
      raw.answer.recommendation.assumptions.items = Array.from({ length: 5 }, (_, at) => ({
        text: `Assumption ${at}`,
        label: 'assumption',
        basis: String(at),
      })) as never;
      raw.changes.assumptions = [];
    });
    expect(assumptionsOf(some)).toMatchObject({ total: 5, more: 5 - GLANCE.assumptions, flips: 0 });
    expect(gistOf('assumptions', some)).toBe('5 assumptions');
  });

  it('gives the recommendation with how much of it is stated and which parts are not, an unknown among them', () => {
    const canvas = canvasFixture();
    // The card’s own list holds reversibility while it is unknown, and the count and the words follow the list.
    expect(canvas.answer.recommendation.missing).toEqual(['weakeningEvidence', 'reversibility']);
    const done = completenessOf(canvas.answer.recommendation);
    expect(done).toMatchObject({ total: 9, stated: 7 });
    expect(done.missing).toEqual(['Evidence that weakens it', 'Reversibility (unknown)']);
    const said = text(render(handleOf(viewFixture(canvas))));
    expect(said).toContain('7 of 9 parts stated');
    expect(said).toContain('Missing: Evidence that weakens it, Reversibility (unknown)');
    // A recommendation that is known to be reversible, with nothing else missing, is whole.
    const whole = canvasFixture((raw) => {
      raw.answer.recommendation.missing = [];
      raw.answer.recommendation.reversibility.value = 'reversible';
    });
    expect(completenessOf(whole.answer.recommendation)).toMatchObject({ stated: 9, missing: [] });
    // Data that says “unknown” and does not list it is never counted as a part stated.
    const unlisted = canvasFixture((raw) => {
      raw.answer.recommendation.missing = ['weakeningEvidence'];
    });
    expect(completenessOf(unlisted.answer.recommendation)).toEqual(done);
  });

  it('lists reversibility among the missing parts in every picture, so that the data and the page agree', () => {
    const cards = [
      canvasFixture(),
      richFixture(),
      ...DECISION_STATUSES.map((status) => statusFixture(status)),
      scopedFixture('domain'),
      scopedFixture('individual', richFixture()),
    ].map((canvas) => canvas.answer.recommendation);
    for (const card of cards) {
      expect(card.reversibility.value).toBe('unknown');
      expect(card.missing).toContain('reversibility');
      // The page adds nothing of its own: what it counts is the length of the list.
      expect(completenessOf(card).stated).toBe(9 - card.missing.length);
    }
  });

  it('says in the recommendation in full that reversibility is missing, in the same words as the list', () => {
    const said = text(render(handleOf(viewFixture(canvasFixture()))));
    expect(said).toContain('Whether it can be reversed: Unknown');
    expect(said).toMatch(/Missing\. Whether the choice can be reversed is unknown/u);
  });

  it('says what kind of statement the answer is, in words for a screen reader too', () => {
    const markup = render(handleOf(viewFixture()));
    expect(markup).toContain('Kind of statement: </span>Recommendation');
    expect(text(markup)).toContain('Scenario possibility');
    expect(text(markup)).toContain('Simulation event');
  });

  it('writes every label and what it means in the legend, which is in the page and not only in a tooltip', () => {
    const said = text(render(handleOf(viewFixture())));
    for (const label of EPISTEMIC_LABELS) {
      expect(said, label).toContain(EPISTEMIC_LABEL_INFO[label].name);
      expect(said, label).toContain(EPISTEMIC_LABEL_INFO[label].meaning);
    }
  });

  it('keeps the full report one step below, when there is one', () => {
    expect(text(render(handleOf(viewFixture())))).toContain('Full report');
    expect(text(render(handleOf(viewFixture()), { below: false }))).not.toContain('Full report');
  });

  it('says provisional and out of date in words, not in colour', () => {
    const provisional = canvasFixture((canvas) => {
      canvas.constraints.gate = 'provisional';
      canvas.constraints.provisional = true;
      canvas.constraints.reviewed = true;
      canvas.constraints.hard = [constraintRow()];
    });
    const said = text(render(handleOf(viewFixture(provisional))));
    expect(said).toContain('Provisional');
    expect(said).toContain('1 not confirmed');
    const stale = canvasFixture((canvas) => {
      canvas.freshness.stale = true;
      canvas.freshness.changedSince = ['constraints'];
    });
    const old = text(render(handleOf(viewFixture(stale))));
    expect(old).toContain('Not current');
    expect(old).toContain('This picture describes the project as it was');
  });

  it('says that no future is shown when there are too few runs to show one', () => {
    const few = canvasFixture((canvas) => {
      canvas.futures.supported = false;
      canvas.futures.items = [];
      canvas.futures.note =
        'Too few seeded runs of each option to describe how a future would go: at least 10 are needed.';
    });
    const said = text(render(handleOf(viewFixture(few))));
    expect(said).toContain('Too few seeded runs');
    expect(render(handleOf(viewFixture(few)))).not.toContain('sw-canvas-futures');
  });

  it('writes what the server or a source says as text, never as markup', () => {
    const hostile = canvasFixture((canvas) => {
      canvas.question.asked = '<img src=x onerror=alert(1)> What should we do?';
      canvas.drivers[0]!.statement.text = '<script>alert(2)</script> moved the most';
    });
    const markup = render(handleOf(viewFixture(hostile)));
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('<script');
    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  describe('how the participants were made', () => {
    const originOf = (source: 'model' | 'rules' | 'rules-fallback' | 'user' | 'unknown') =>
      canvasFixture((canvas) => {
        canvas.actors.origin =
          source === 'rules-fallback'
            ? {
                source,
                label: 'Participants from the rules fallback',
                detail:
                  'The model’s answer was cut short. Swarm read the text for roles instead, so no model proposed these participants.',
              }
            : source === 'model'
              ? {
                  source,
                  label: 'Participants proposed by a model',
                  detail:
                    'The model gpt-5-mini proposed them, and Swarm checked every quotation against the sources.',
                }
              : source === 'user'
                ? {
                    source,
                    label: 'Participants added by a person',
                    detail: 'A person built this list. Swarm did not propose it.',
                  }
                : source === 'unknown'
                  ? { source, label: 'Participants: not recorded', detail: 'No list was recorded.' }
                  : canvas.actors.origin;
      });

    it('says in words, beside the roles, that a list the rules made after the model failed is the rules fallback, and not the model’s', () => {
      const markup = render(handleOf(viewFixture(originOf('rules-fallback'))));
      const who = markup.slice(
        markup.indexOf('data-canvas-item="who"'),
        markup.indexOf('data-canvas-item="constraints"'),
      );
      expect(who).toContain('data-origin="rules-fallback"');
      expect(text(who)).toContain('Participants from the rules fallback.');
      expect(text(who)).toContain('no model proposed these participants');
      expect(text(who)).not.toMatch(/proposed by a model/iu);
    });

    it('says the same where the roles are given in full', () => {
      const canvas = originOf('rules-fallback');
      const markup = renderToStaticMarkup(
        <TooltipProvider>
          <Detail canvas={canvas} open={new Set(['actors'])} onOpenChange={noop} />
        </TooltipProvider>,
      );
      const start = markup.indexOf('data-detail="actors"');
      expect(start).toBeGreaterThan(0);
      const actors = markup.slice(start, markup.indexOf('</section>', start));
      expect(actors).toContain('data-origin="rules-fallback"');
      expect(text(actors)).toContain('Participants from the rules fallback.');
    });

    it('says that a model proposed them, that rules did, or that a person did, as it was; and nothing where it was not recorded', () => {
      expect(text(render(handleOf(viewFixture(originOf('model')))))).toContain(
        'Participants proposed by a model.',
      );
      expect(text(render(handleOf(viewFixture(originOf('rules')))))).toContain(
        'Participants read from the text by rules.',
      );
      expect(text(render(handleOf(viewFixture(originOf('user')))))).toContain(
        'Participants added by a person.',
      );
      const unknown = render(handleOf(viewFixture(originOf('unknown'))));
      expect(unknown).not.toContain('data-origin=');
      expect(text(unknown)).not.toContain('Participants: not recorded');
    });

    it('does not call any other list the rules fallback', () => {
      for (const source of ['model', 'rules', 'user'] as const) {
        expect(text(render(handleOf(viewFixture(originOf(source)))))).not.toContain(
          'rules fallback',
        );
      }
    });
  });
});

describe('the decision canvas when there is nothing to show', () => {
  it('draws the shape of the page while it is read', () => {
    const markup = render(handleOf(null, { loading: true }));
    expect(markup).toContain('aria-busy="true"');
    expect(text(markup)).toContain('Loading the decision view');
    expect(markup).not.toContain('data-canvas-item');
  });

  it('says it could not be read, with a way to try again, and keeps what it had', () => {
    const failed = text(render(handleOf(null, { error: 'The server did not answer.' })));
    expect(failed).toContain('The decision view could not be read');
    expect(failed).toContain('The server did not answer.');
    expect(failed).toContain('Try again');
    expect(failed).toContain('Nothing has been lost');
    const kept = text(render(handleOf(viewFixture(), { error: 'The server did not answer.' })));
    expect(kept).toContain('What is shown is the last version that could be read.');
    expect(kept).toContain('Current best answer');
  });

  it.each([
    ['no-analysis', 'simulate', 'No comparison has been run yet.', 'Open Simulate'],
    ['no-analysis', 'ground', 'No comparison has been run yet.', 'Open Ground'],
    ['no-analysis', 'ask', 'No comparison has been run yet.', 'Open Ask'],
    ['failed', 'simulate', 'The last comparison did not finish', 'Open Simulate'],
  ] as const)('says %s with the step that is missing: %s', (state, next, said, action) => {
    const page = text(render(handleOf(emptyFixture(state, next)), { below: false }));
    expect(page).toContain('Nothing to decide from yet');
    expect(page).toContain(said);
    expect(page).toContain(action);
    expect(page).not.toContain('Current best answer');
  });

  it('says that a comparison is running and offers nothing to press', () => {
    const markup = render(handleOf(emptyFixture('running')), { below: false });
    expect(text(markup)).toContain('Not ready yet');
    expect(text(markup)).toContain('A comparison is running.');
    expect(markup).not.toContain('Open Simulate');
  });

  it('offers the detailed report where the exploration has one', () => {
    const view = handleOf(emptyFixture('no-analysis'));
    expect(text(render(view, { below: false }))).not.toContain('Detailed report');
    expect(text(render(view, { below: false, detailed: true }))).toContain('Detailed report');
  });
});

describe('what the page says of what Swarm does not decide', () => {
  const domain = (status: (typeof DECISION_STATUSES)[number]) =>
    viewFixture(scopedFixture('domain', statusFixture(status), ['employment', 'legal']));

  it.each(DECISION_STATUSES)('shows the notice and the matters it matched, for %s', (status) => {
    const markup = render(handleOf(domain(status)));
    const said = text(markup);
    expect(said).toContain(SCOPE_NOTICE);
    expect(said).toContain(`${COPY.scopeMatched} ${SCOPE_DOMAIN_WORDS.employment.label}`);
    expect(said).toContain(SCOPE_DOMAIN_WORDS.legal.label);
    expect(markup).toContain('role="note"');
    expect(markup).toContain(`aria-label="${COPY.scopeLabel}"`);
    expect(markup).toContain('data-scope="domain"');
    // A matter in general changes nothing else: the status is the one the simulation gave.
    expect(said).toContain(DECISION_STATUS_INFO[status].label);
  });

  it('puts the notice in the header, before the tools and above the ten things', () => {
    const markup = render(handleOf(domain('robust-option')));
    const at = (needle: string) => markup.indexOf(needle);
    expect(at('sw-canvas-top__lead')).toBeLessThan(at('sw-canvas-scope'));
    expect(at('sw-canvas-scope')).toBeLessThan(at('sw-canvas-top__tools'));
    expect(at('sw-canvas-top__tools')).toBeLessThan(at('data-canvas-item'));
  });

  it('says nothing of it where the question touches none of the five matters', () => {
    const markup = render(handleOf(viewFixture(statusFixture('robust-option'))));
    expect(markup).not.toContain('sw-canvas-scope');
    expect(markup).not.toContain('data-scope');
    expect(text(markup)).not.toContain(SCOPE_NOTICE);
    // The approvals detail still says that Swarm decides nothing.
    expect(text(markup)).toContain(COPY.noScope);
  });

  it('says in words, not in colour, that a decision about one person is for a person to decide', () => {
    const canvas = scopedFixture('individual', statusFixture('robust-option'));
    const markup = render(handleOf(viewFixture(canvas)));
    const said = text(markup);
    expect(markup).toContain('data-scope="individual"');
    expect(markup).toContain('data-status="needs-human-decision"');
    expect(said).toContain(DECISION_STATUS_INFO['needs-human-decision'].label);
    expect(said).toContain(SCOPE_NOTICE);
    expect(said).toContain(
      'A qualified person decides this; here is what the exploration can and cannot tell them.',
    );
    expect(said).toContain(canvas.status.headline);
    expect(canvas.answer.preferredAlternativeId).toBeNull();
  });

  it('names no option as preferred, and shows the options as explored and not ranked', () => {
    const canvas = scopedFixture('individual', richFixture());
    const said = text(render(handleOf(viewFixture(canvas))));
    expect(said).toContain('Not ranked');
    expect(said).not.toContain('Preferred');
    expect(said).not.toContain('Take “');
    for (const option of canvas.alternatives) {
      expect(['not-ranked', 'blocked']).toContain(option.verdict);
    }
  });

  it('says what the exploration can and cannot tell the person who decides, one of each at a glance', () => {
    const canvas = scopedFixture('individual');
    const glance = explorationOf(canvas);
    expect(glance).not.toBeNull();
    expect(glance!.canTell).toHaveLength(GLANCE.canTell);
    expect(glance!.cannotTell).toHaveLength(GLANCE.cannotTell);
    expect(glance!.more).toBe(
      canvas.scope.exploration!.canTell.length -
        GLANCE.canTell +
        (canvas.scope.exploration!.cannotTell.length - GLANCE.cannotTell),
    );
    const markup = render(handleOf(viewFixture(canvas)));
    expect(text(markup)).toContain(COPY.canTell);
    expect(text(markup)).toContain(COPY.cannotTell);
    // Each carries its kind of statement.
    expect(markup).toContain('Kind of statement: </span>Simulation event');
    expect(markup).toContain('Kind of statement: </span>Validation requirement');
    // In full, all of them, under the recommendation.
    for (const line of [
      ...canvas.scope.exploration!.canTell,
      ...canvas.scope.exploration!.cannotTell,
    ]) {
      expect(text(markup)).toContain(line.text);
    }
    expect(text(markup)).toContain(COPY.canTellDetail);
    expect(text(markup)).toContain(COPY.cannotTellDetail);
  });

  it('shows no can or cannot tell list for a matter in general, or for none', () => {
    expect(explorationOf(canvasFixture())).toBeNull();
    expect(explorationOf(scopedFixture('domain'))).toBeNull();
    const markup = render(handleOf(domain('conditional-option')));
    expect(markup).not.toContain('sw-canvas-tell');
  });

  it('says no view could reverse a choice that is not made', () => {
    const base = richFixture();
    const answered = text(render(handleOf(viewFixture(base))));
    expect(answered).toContain(COPY.couldReverse);
    const said = text(render(handleOf(viewFixture(scopedFixture('individual', base)))));
    expect(said).not.toContain(COPY.couldReverse);
    expect(said).not.toContain(COPY.notTold);
  });

  it('shows the matters, who reviews each and the cues the reading rests on, in the approvals', () => {
    const canvas = scopedFixture('individual', canvasFixture(), ['medical', 'legal']);
    const said = text(render(handleOf(viewFixture(canvas))));
    expect(said).toContain(COPY.reviewTitle);
    expect(said).toContain(SCOPE_DOMAIN_WORDS.medical.reviewer);
    expect(said).toContain(SCOPE_DOMAIN_WORDS.legal.reviewer);
    expect(said).toContain(canvas.scope.basis[0]);
    expect(said).toContain(COPY.scopeLimits);
    // The approval that stands for a qualified person is one of the points, and is open.
    expect(canvas.approvals.at(-1)).toMatchObject({ id: 'approve-qualified', state: 'open' });
  });

  it('is there without a canvas: for a question about one person with nothing yet run', () => {
    const view = emptyFixture('no-analysis', 'simulate', scopeFixture('individual', ['medical']));
    const markup = render(handleOf(view), { below: false });
    const said = text(markup);
    expect(markup).toContain('data-scope="individual"');
    expect(said).toContain(SCOPE_NOTICE);
    expect(said).toContain(`${COPY.scopeMatched} ${SCOPE_DOMAIN_WORDS.medical.label}`);
    expect(said).toContain('a qualified person decides');
    expect(markup).not.toContain('data-canvas-item');
    // Nothing is blocked: what is missing and the step that supplies it are still there.
    expect(said).toContain('No comparison has been run yet.');
    expect(said).toContain('Open Simulate');
    // Without a matter, nothing is said.
    const none = render(handleOf(emptyFixture('no-analysis')), { below: false });
    expect(none).not.toContain('sw-canvas-scope');
  });

  it('is there while an old picture is kept after the page could not be read again', () => {
    const view = viewFixture(scopedFixture('individual'));
    const said = text(render(handleOf(view, { error: 'The server did not answer.' })));
    expect(said).toContain(SCOPE_NOTICE);
    expect(said).toContain('What is shown is the last version that could be read.');
  });

  it('puts the note into the bridge to the full report only where a matter was found', () => {
    expect(text(renderToStaticMarkup(<ReportBridge scoped />))).toContain(COPY.scopeBridge);
    expect(text(renderToStaticMarkup(<ReportBridge />))).not.toContain(COPY.scopeBridge);
  });

  it('writes the cues as text, never as markup', () => {
    const hostile = scopedFixture('individual');
    hostile.scope.basis = ['employment: “<img src=x onerror=alert(1)>”'];
    const markup = render(handleOf(viewFixture(hostile)));
    expect(markup).not.toContain('<img');
    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('has a gist for the narrow page that says a person decides', () => {
    const canvas = scopedFixture('individual');
    expect(gistOf('answer', canvas)).toBe(DECISION_STATUS_INFO['needs-human-decision'].label);
    expect(gistOf('next', canvas)).toContain('A qualified person decides this');
  });

  it('puts the check that a qualified person decides before every other, for a decision about one person', () => {
    const canvas = scopedFixture('individual');
    const [first] = checksOf(canvas).items;
    expect(first).toMatchObject({ source: 'scope', priority: 'high' });
    expect(first?.what).toMatch(
      /^Have a qualified human resources or employment-law professional decide this/u,
    );
    expect(text(render(handleOf(viewFixture(canvas))))).toContain(first!.what);
    expect(canvas.validation.stopConditions[0]?.id).toBe('stop-qualified-person');
    // For a matter in general the plan is the simulation's own.
    expect(checksOf(scopedFixture('domain')).items.every((item) => item.source !== 'scope')).toBe(
      true,
    );
  });
});

describe('what the page says about itself', () => {
  it('makes no claim the product may not make, in any state or status', () => {
    const pages = [
      ...DECISION_STATUSES.map((status) => render(handleOf(viewFixture(statusFixture(status))))),
      render(handleOf(viewFixture(richFixture()))),
      render(
        handleOf(
          viewFixture(
            canvasFixture((canvas) => {
              canvas.freshness.stale = true;
              canvas.freshness.changedSince = [COMPARISON_INPUTS_UNRECORDED];
              canvas.freshness.newerRunning = true;
              canvas.constraints.gate = 'provisional';
              canvas.constraints.provisional = true;
              canvas.constraints.hard = [constraintRow()];
            }),
          ),
        ),
      ),
      render(handleOf(emptyFixture('no-analysis'))),
      render(handleOf(emptyFixture('running'))),
      render(handleOf(emptyFixture('failed'))),
      ...DECISION_STATUSES.map((status) =>
        render(handleOf(viewFixture(scopedFixture('domain', statusFixture(status), ['medical'])))),
      ),
      render(handleOf(viewFixture(scopedFixture('individual')))),
      render(
        handleOf(viewFixture(scopedFixture('individual', richFixture(), ['employment', 'legal']))),
      ),
      render(
        handleOf(emptyFixture('no-analysis', 'simulate', scopeFixture('individual', ['credit']))),
      ),
      render(handleOf(null, { loading: true })),
      render(handleOf(null, { error: 'It failed.' })),
    ];
    for (const markup of pages) {
      const said = text(markup);
      expect(said).not.toContain('%');
      expect(claimsAgainst(said)).toEqual([]);
    }
  });

  it('holds its own words to the same guard', () => {
    for (const [name, words] of Object.entries(COPY)) {
      expect(claimsAgainst(words), name).toEqual([]);
      expect(words, name).not.toContain('%');
    }
  });
});

describe('what the page works out from the view', () => {
  it('tells which state the page is in', () => {
    expect(stateOf(null, true, null)).toBe('loading');
    expect(stateOf(null, false, 'It failed.')).toBe('error');
    expect(stateOf(viewFixture(), false, null)).toBe('ready');
    expect(stateOf(emptyFixture('no-analysis'), false, null)).toBe('no-analysis');
    expect(stateOf(emptyFixture('running'), false, null)).toBe('running');
    expect(stateOf(emptyFixture('failed'), false, null)).toBe('failed');
    expect(stateOf(viewFixture(), false, 'It failed.')).toBe('ready');
  });

  it('says where the constraint gate stands in a word that is not a colour', () => {
    const gate = (
      gateName: 'none' | 'clear' | 'provisional' | 'blocked',
      comparison: 'none' | 'clear' | 'provisional',
    ) =>
      gateWords(
        canvasFixture((raw) => {
          raw.constraints.gate = gateName;
          raw.constraints.comparisonStatus = comparison;
        }).constraints,
      );
    expect(gate('blocked', 'none')).toEqual({ label: 'Blocked', tone: 'critical' });
    expect(gate('provisional', 'provisional')).toEqual({ label: 'Provisional', tone: 'caution' });
    expect(gate('none', 'none')).toEqual({ label: 'Not reviewed', tone: 'caution' });
    expect(gate('clear', 'clear')).toEqual({ label: 'Clear', tone: 'favor' });
    expect(gate('clear', 'provisional').tone).toBe('caution');
  });

  it('counts hard and soft constraints, those not confirmed, and how many the glance leaves out', () => {
    const canvas = canvasFixture((raw) => {
      raw.constraints.gate = 'provisional';
      raw.constraints.hard = [
        constraintRow({ id: 'a', provisional: false }),
        constraintRow({ id: 'b', provisional: true }),
      ];
      raw.constraints.soft = [
        constraintRow({ id: 'c', hardness: 'soft' }),
        constraintRow({ id: 'd', hardness: 'soft' }),
      ];
    });
    const glance = constraintGlance(canvas);
    expect(glance).toMatchObject({
      hard: 2,
      soft: 2,
      provisional: 1,
      more: 4 - GLANCE.constraints,
    });
    // What the answer rests on without anyone having confirmed it comes first.
    expect(glance.rows.map((row) => row.id)).toEqual(['b', 'a']);
  });

  it('shows the future that ranks first and the option that changes nothing, when there are more than it holds', () => {
    const canvas = canvasFixture((raw) => {
      const [first, second] = raw.futures.items;
      raw.futures.items = [
        { ...first!, alternativeId: 'a', label: 'Option A', kind: 'alternative' },
        { ...second!, alternativeId: 'b', label: 'Option B', kind: 'alternative' },
        { ...first!, alternativeId: 'baseline', label: 'No change', kind: 'baseline' },
      ];
    });
    expect(futureItems(canvas).map((future) => future.alternativeId)).toEqual(['a', 'baseline']);
    expect(futureItems(canvasFixture())).toHaveLength(2);
  });

  it('writes a change as simulated members in 100, never as a percent', () => {
    expect(changeWords({ adverseChange: 0.47 })).toBe('+47 in 100');
    expect(changeWords({ adverseChange: -0.0233 })).toBe('−2.3 in 100');
    expect(changeWords({ adverseChange: null })).toBeNull();
    expect(moveWords({ moves: 'toward-resistance', adverseChange: 0.47 })).toBe('More resistance');
    expect(moveWords({ moves: 'unknown', adverseChange: null })).toBe('Not compared');
  });

  it('puts the views that could reverse the answer first, then the largest, then those that were not run', () => {
    const view = (
      id: string,
      deltaVsBase: number | null,
      couldChangeAnswer: boolean | null,
      applicable = true,
    ) =>
      ({
        id,
        label: id,
        change: '',
        applicable,
        deltaVsBase,
        standardError: null,
        classification: null,
        driver: '',
        couldChangeAnswer,
        statement: { text: id, label: 'simulation-event' },
      }) as never;
    const ordered = strip(
      [
        view('small', 0.01, false),
        view('not-run', null, null, false),
        view('reverses', 0.05, true),
        view('large', 0.2, false),
      ],
      4,
    ).map((entry) => entry.id);
    expect(ordered).toEqual(['reverses', 'large', 'small', 'not-run']);
    expect(viewWords(view('x', null, null)).effect).toBe('Not run');
    expect(viewWords(view('x', 0.1, true)).flag).toBe(COPY.couldReverse);
    expect(viewWords(view('x', 0.1, null)).flag).toBe(COPY.notTold);
  });

  it('puts the assumptions that could reverse the answer first', () => {
    const row = (id: string, shift: number, flipsAnswer: boolean) =>
      ({
        id,
        statement: { text: id, label: 'assumption' },
        origin: 'system-assumption',
        classification: 'robust',
        shift,
        standardError: 0.01,
        flipsAnswer,
        evidenced: false,
      }) as never;
    const ordered = assumptionGlance([row('big', 0.4, false), row('flips', 0.05, true)], 2);
    expect(ordered.map((entry) => entry.id)).toEqual(['flips', 'big']);
  });

  it('counts the checks that come before acting', () => {
    const checks = checksOf(canvasFixture());
    expect(checks.before).toBe(1);
    expect(checks.items).toHaveLength(2);
    expect(checks.more).toBe(0);
  });

  it('names a role without what it is said to do', () => {
    expect(roleName({ role: 'Operations: Carries out or supports the change day to day' })).toBe(
      'Operations',
    );
    expect(roleName({ role: 'Partner' })).toBe('Partner');
  });

  it('says in one line what each item holds, for the narrow page where it is folded', () => {
    const canvas = canvasFixture();
    for (const item of ITEMS) {
      const gist = gistOf(item, canvas);
      expect(gist.length, item).toBeGreaterThan(0);
      expect(gist.length, item).toBeLessThanOrEqual(120);
      expect(gist, item).not.toContain('%');
    }
  });

  it('never says that nothing reverses the answer when nothing was tried against it', () => {
    const view = (id: string, deltaVsBase: number | null, couldChangeAnswer: boolean | null) =>
      ({
        id,
        label: id,
        change: '',
        applicable: true,
        deltaVsBase,
        standardError: null,
        classification: null,
        driver: '',
        couldChangeAnswer,
        statement: { text: id, label: 'simulation-event' },
      }) as never;
    const gist = (
      views: unknown[],
      moved: { tested?: number; inconclusive?: number; flips?: boolean[]; answered?: boolean } = {},
    ) => {
      const { tested = 0, inconclusive = 0, flips = [], answered = true } = moved;
      const canvas = canvasFixture();
      const [template] = canvas.changes.assumptions;
      canvas.changes.counterfactuals.views = views as never;
      canvas.changes.sensitivity = {
        ...canvas.changes.sensitivity,
        tested,
        sensitive: flips.length,
        inconclusive,
        robust: tested - flips.length - inconclusive,
      };
      canvas.changes.assumptions = flips.map((flipsAnswer, at) => ({
        ...template!,
        id: `a${at}`,
        flipsAnswer,
      }));
      if (!answered) canvas.answer.preferredAlternativeId = null;
      return gistOf('changes', canvas);
    };
    expect(gist([])).toBe('Nothing was tried against it');
    expect(gist([view('v', null, null)])).toBe('Nothing was tried against it');
    expect(gist([view('v', 0.02, false)], { tested: 3 })).toBe('4 tried; none reverses it');
    expect(gist([], { tested: 12, inconclusive: 2 })).toBe('12 tried; 2 cannot be told');
    expect(gist([view('v', 0.02, null)])).toBe('1 tried; 1 cannot be told');
    expect(gist([view('v', 0.02, false)], { tested: 2, flips: [true] })).toBe(
      '1 could reverse the answer',
    );
    expect(gist([view('v', 0.02, false)], { tested: 2, answered: false })).toBe('3 tried');
  });

  it('says what the sensitivity step moved and found, or that it was not run', () => {
    const sensitivity = canvasFixture().changes.sensitivity;
    expect(sensitivityWords({ ...sensitivity, tested: 0 })).toBe(
      'Sensitivity to assumptions was not run.',
    );
    expect(
      sensitivityWords({ ...sensitivity, tested: 12, sensitive: 0, robust: 10, inconclusive: 2 }),
    ).toBe(
      '12 assumptions moved on the same seeds: 0 moved the result clearly, 10 did not, 2 could not be told.',
    );
  });

  it('names what a stale picture was made before, or says that it cannot tell', () => {
    expect(noticesOf(canvasFixture())).toEqual([]);
    const known = noticesOf(
      canvasFixture((canvas) => {
        canvas.freshness.stale = true;
        canvas.freshness.changedSince = ['constraints'];
      }),
    );
    expect(known).toHaveLength(1);
    expect(known[0]!.text).toMatch(/before .*constraints.* changed/iu);
    const unrecorded = noticesOf(
      canvasFixture((canvas) => {
        canvas.freshness.stale = true;
        canvas.freshness.changedSince = [COMPARISON_INPUTS_UNRECORDED];
      }),
    );
    expect(unrecorded[0]!.text).toContain('cannot be told');
    const running = noticesOf(
      canvasFixture((canvas) => {
        canvas.freshness.newerRunning = true;
      }),
    );
    expect(running).toHaveLength(1);
    expect(running[0]!.tone).toBe('info');
  });
});
