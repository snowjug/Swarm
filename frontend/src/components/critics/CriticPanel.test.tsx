import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CHANGE_CANNOT_MOVE_ID, CRITIC_ROLE_QUESTIONS } from '../../../../shared/critique';
import { critiqueFixture, setFixture, stateFixture, viewFixture } from '../../test/critics';
import { expectNoSecretLikeText, visibleText } from '../../test/provider';
import { projectFixture } from '../../test/project';
import { LEAD_EXPLANATION, LEAD_HEADING } from '../../lib/critics';
import { CriticPanel, CriticReview } from './CriticPanel';

const render = (patch: Parameters<typeof stateFixture>[0] = {}) =>
  renderToStaticMarkup(<CriticReview state={stateFixture(patch)} />);

const passage = {
  passageId: 'd1-p1',
  documentId: 'd1',
  documentName: 'Source d1',
  start: 0,
  end: 80,
  quote: 'The quoted passage the criticism rests on.',
  contentHash: 'hash-d1-1',
  role: 'supports' as const,
};

const populated = () =>
  viewFixture({
    critiques: setFixture(
      [
        critiqueFixture({
          id: 'adversarial-gap-s1',
          role: 'adversarial',
          severity: 'blocking',
          target: { kind: 'assumption', id: 's1' },
          objection: 'The conclusion could be wrong if the switching cost is not what was assumed.',
          basis: ['Gap on the measure: 0.45 against 0.10.', 'Origin: system-assumption.'],
          impactOnConclusion: 'If this stands, the direction depends on this assumption.',
        }),
        critiqueFixture({
          id: 'evidence-single-source',
          role: 'evidence',
          severity: 'major',
          objection: 'Most cited passages come from one document.',
          evidence: [passage],
          origin: 'rules',
        }),
        critiqueFixture({
          id: 'model-bias-1a2b3c4d',
          role: 'bias',
          severity: 'note',
          origin: 'model',
          target: { kind: 'finding', id: 'f1' },
          objection: 'The cast leans toward people affected by the change.',
        }),
      ],
      { mode: 'both' },
    ),
  });

describe('the independent review', () => {
  it('names itself, says critics never change the analysis, and says what Swarm is not', () => {
    const text = visibleText(render());
    expect(text).toContain('Independent review');
    expect(text).toContain('Critics challenge the analysis and never change it');
    expect(text).toContain('does not guarantee or precisely predict real-world behaviour');
  });

  describe('before there is anything to show', () => {
    it('says that it is reading, with a status a screen reader announces', () => {
      const html = render({ view: null, loading: true });
      expect(html).toContain('role="status"');
      expect(visibleText(html)).toContain('Reading the independent review');
      expect(html).not.toContain('<form');
    });

    it('says that it could not read, with the reason and a way to try again', () => {
      const html = render({ view: null, error: 'The server returned an unreadable response.' });
      const text = visibleText(html);
      expect(text).toContain('The independent review could not be read');
      expect(text).toContain('The server returned an unreadable response.');
      expect(html).toContain('Retry');
      expect(html).toContain('role="alert"');
    });

    it('explains that there is no finished analysis, and offers no review to run', () => {
      const html = render({ view: viewFixture({ critiques: null, analysis: null }) });
      const text = visibleText(html);
      expect(text).toContain('There is no finished analysis to review yet');
      expect(text).toContain('Compare scenarios first');
      expect(text).not.toContain('Run independent review');
      expect(html).not.toContain('<button');
    });

    it('offers the review when an analysis is finished, and says what a deterministic check and a model review are', () => {
      const html = render({ view: viewFixture({ critiques: null }) });
      const text = visibleText(html);
      expect(text).toContain('No independent review yet');
      expect(text).toContain('Run an independent review');
      expect(text).toContain('The deterministic checks always run');
      expect(text).toContain('same input always gives the same criticisms');
      expect(text).toContain('The optional model review');
      expect(text).toContain('Anything it says about an id that does not exist is dropped');
      expect(text).toContain('it cannot change a finding');
      expect(text).toContain('Run independent review');
      // Nothing is claimed about results that do not exist.
      expect(text).not.toContain('What the review found');
    });
  });

  describe('asking for a review', () => {
    it('leaves the model out when none is configured, and says why', () => {
      const html = render({ view: viewFixture({ critiques: null }) });
      expect(visibleText(html)).toContain(
        'No model is configured, so only the deterministic checks can run',
      );
      expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""/u);
    });

    it('lets a person ask for the model review when one is configured', () => {
      const html = render({ view: viewFixture({ critiques: null, model: { available: true } }) });
      expect(visibleText(html)).toContain('Also ask the model for a deeper review');
      expect(html).not.toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""/u);
      expect(html).toMatch(/<label for="([^"]+)-model">/u);
      expect(visibleText(html)).not.toContain('No model is configured');
    });

    it('disables the button while a review is running, and says so', () => {
      const html = render({ view: viewFixture({ critiques: null }), running: true });
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*Running the independent review/u);
    });

    it('says why a review did not run', () => {
      const html = render({
        view: viewFixture({ critiques: null }),
        runError: 'There is no finished analysis to review yet.',
      });
      expect(visibleText(html)).toContain('The independent review did not run');
      expect(visibleText(html)).toContain('There is no finished analysis to review yet.');
      expect(html).toContain('role="alert"');
    });

    it('does not offer the review to someone who may not run it, and says who may', () => {
      const html = render({
        view: viewFixture({ critiques: null, may: { run: false, respond: false } }),
      });
      expect(visibleText(html)).toContain(
        'Only someone who can run analyses on this experiment can start a review',
      );
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*Run independent review/u);
    });

    it('says that responses are kept when the review is run again', () => {
      const text = visibleText(render({ view: populated() }));
      expect(text).toContain('Run the review again');
      expect(text).toContain('Your responses are kept for any criticism that comes back unchanged');
    });
  });

  describe('the summary', () => {
    it('counts the criticisms by severity and by status, in words', () => {
      const html = render({ view: populated() });
      const text = visibleText(html);
      expect(text).toContain('What the review found');
      expect(text).toContain('3 criticisms raised against this analysis');
      expect(text).toContain(
        'A criticism is a challenge, not a verdict, and none of them has changed a finding',
      );
      expect(text).toContain(
        'Deterministic checks and a model review. Made 2026-02-01 for analysis analysis-1',
      );
      const severities =
        html.match(/<ul[^>]*aria-label="Criticisms by severity"[\s\S]*?<\/ul>/u)?.[0] ?? '';
      expect(visibleText(severities)).toBe('Blocking 1 Major 1 Minor 0 Note 1');
      const statuses =
        html.match(/<ul[^>]*aria-label="Criticisms by status"[\s\S]*?<\/ul>/u)?.[0] ?? '';
      expect(visibleText(statuses)).toBe('Open 3 Responded 0 Accepted 0 Disputed 0');
    });

    it('says that no criticism is not the same as the analysis being right', () => {
      const text = visibleText(render({ view: viewFixture({ critiques: setFixture([]) }) }));
      expect(text).toContain('The checks raised no criticism');
      expect(text).toContain('does not show that the analysis is right');
    });

    it('says how the review was made when something went wrong with a part of it', () => {
      const text = visibleText(
        render({
          view: viewFixture({
            critiques: setFixture([critiqueFixture()], {
              notes: [
                'The model review could not be completed, so only the deterministic checks are shown.',
              ],
            }),
          }),
        }),
      );
      expect(text).toContain('About how this review was made');
      expect(text).toContain('The model review could not be completed');
    });

    it('says that the review is of an earlier analysis when a newer one has finished', () => {
      const html = render({
        view: viewFixture({
          analysis: { id: 'analysis-2', completedAt: '2026-03-01T00:00:00.000Z' },
        }),
      });
      expect(visibleText(html)).toContain('This review is of an earlier analysis');
      expect(html).toContain('notice-warning');
    });
  });

  describe('the criticisms', () => {
    it('groups them by critic, headed by the question each critic asks', () => {
      const html = render({ view: populated() });
      const headings = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gu)].map((m) =>
        visibleText(m[1] ?? ''),
      );
      expect(headings).toContain(CRITIC_ROLE_QUESTIONS.evidence);
      expect(headings).toContain(CRITIC_ROLE_QUESTIONS.bias);
      expect(headings).toContain(CRITIC_ROLE_QUESTIONS.adversarial);
      expect(headings).not.toContain(CRITIC_ROLE_QUESTIONS.methodology);
      // The critics keep their own order whatever the severity.
      expect(headings.indexOf(CRITIC_ROLE_QUESTIONS.evidence)).toBeLessThan(
        headings.indexOf(CRITIC_ROLE_QUESTIONS.bias),
      );
      expect(headings.indexOf(CRITIC_ROLE_QUESTIONS.bias)).toBeLessThan(
        headings.indexOf(CRITIC_ROLE_QUESTIONS.adversarial),
      );
      const text = visibleText(html);
      expect(text).toContain('Evidence critic');
      expect(text).toContain('Adversarial reviewer');
      expect(text).toContain('1 criticism');
    });

    it('shows, on each, a severity chip, its origin, its status, what it says and what it rests on', () => {
      const html = render({ view: populated() });
      const text = visibleText(html);
      expect(text).toContain('Blocking');
      expect(text).toContain('Rules check');
      expect(text).toContain('Model review');
      expect(text).toContain('Open');
      expect(text).toContain('Assumption s1');
      expect(text).toContain('Finding f1');
      expect(text).toContain(
        'The conclusion could be wrong if the switching cost is not what was assumed.',
      );
      expect(text).toContain('What it rests on');
      expect(text).toContain('Gap on the measure: 0.45 against 0.10.');
      expect(text).toContain('Origin: system-assumption.');
      // A chip says what it means to anyone who hovers it.
      expect(html).toContain(
        'title="Settle this before the result is used: it could undo the conclusion."',
      );
      expect(html).toContain('title="A fixed rule applied to the data');
    });

    it('shows the evidence a criticism rests on, with its passage', () => {
      const text = visibleText(render({ view: populated() }));
      expect(text).toContain('Evidence');
      expect(text).toContain('Source d1, passage d1-p1');
      expect(text).toContain('The quoted passage the criticism rests on.');
    });

    it('shows what the criticism does to the conclusion if it stands', () => {
      const text = visibleText(render({ view: populated() }));
      expect(text).toContain('Effect on the conclusion, if it stands');
      expect(text).toContain('If this stands, the direction depends on this assumption.');
    });

    it('says that an accepted objection applies, with the response and the day it was given', () => {
      const html = render({
        view: viewFixture({
          critiques: setFixture([
            critiqueFixture({
              status: 'accepted',
              response: {
                text: 'We agree and will change the setup.',
                by: 'user',
                at: '2026-02-03T10:00:00.000Z',
              },
            }),
          ]),
        }),
      });
      const text = visibleText(html);
      expect(text).toContain('Accepted: this applies to the conclusion');
      expect(text).toContain('Response, 2026-02-03');
      expect(text).toContain('We agree and will change the setup.');
      expect(text).toContain('Change your response');
      expect(html).toContain('critic-chip-status-accepted');
    });

    it('keeps a disagreement in view: a disputed criticism shows what is still disputed', () => {
      const text = visibleText(
        render({
          view: viewFixture({
            critiques: setFixture([
              critiqueFixture({
                status: 'disputed',
                response: {
                  text: 'It was on purpose.',
                  by: 'user',
                  at: '2026-02-03T10:00:00.000Z',
                },
                remainingDisagreement: 'Whether the stances should be mixed.',
              }),
            ]),
          }),
        }),
      );
      expect(text).toContain('Disputed: this is what is contested');
      expect(text).toContain('Still disputed');
      expect(text).toContain('Whether the stances should be mixed.');
    });

    it('says so when a criticism is disputed without a reason', () => {
      const text = visibleText(
        render({
          view: viewFixture({
            critiques: setFixture([
              critiqueFixture({
                status: 'disputed',
                response: { text: 'No.', by: 'user', at: '2026-02-03T10:00:00.000Z' },
              }),
            ]),
          }),
        }),
      );
      expect(text).toContain('No reason for the dispute was given.');
    });
  });

  describe('responding', () => {
    it('offers a form on each criticism, with a label for each field and the three things a response can mean', () => {
      const html = render({ view: populated() });
      expect(html.match(/<form/gu)).toHaveLength(3);
      expect(html.match(/<details class="critic-answer"/gu)).toHaveLength(3);
      const text = visibleText(html);
      expect(text).toContain('Respond to this criticism');
      expect(text).toContain('Your response');
      expect(text).toContain('What you still disagree about (optional)');
      for (const label of ['Respond', 'Accept the objection', 'Dispute it']) {
        expect(html).toContain(`>${label}</button>`);
      }
      expect(text).toContain('Respond answers the criticism without settling it');
      expect(text).toContain(
        'Accept means the objection stands and its impact applies to the conclusion',
      );
      expect(text).toContain('Dispute keeps the disagreement in view');
      for (const [, id] of html.matchAll(/<label for="([^"]+)"/gu)) {
        expect(html, id).toContain(`id="${id}"`);
      }
      expect(html).toMatch(/aria-label="Respond to: Assumption s1"/u);
      expect(html).toContain('aria-live="polite"');
    });

    it('fills the form with the earlier response, so that it can be changed', () => {
      const html = render({
        view: viewFixture({
          critiques: setFixture([
            critiqueFixture({
              status: 'disputed',
              response: { text: 'Earlier words.', by: 'user', at: '2026-02-03T10:00:00.000Z' },
              remainingDisagreement: 'Earlier disagreement.',
            }),
          ]),
        }),
      });
      expect(html).toMatch(/<textarea[^>]*>Earlier words\.<\/textarea>/u);
      expect(html).toMatch(/<textarea[^>]*>Earlier disagreement\.<\/textarea>/u);
    });

    it('disables the form while a response is being saved', () => {
      const html = render({ view: populated(), answering: 'adversarial-gap-s1' });
      const saving = html.match(/<form[^>]*Respond to: Assumption s1[\s\S]*?<\/form>/u)?.[0] ?? '';
      expect(saving.match(/disabled=""/gu)?.length).toBeGreaterThanOrEqual(5);
      expect(visibleText(saving)).toContain('Saving your response');
    });

    it('says why a response was not saved, on the criticism it belongs to', () => {
      const html = render({
        view: populated(),
        answerError: {
          id: 'adversarial-gap-s1',
          message: 'Your role on this experiment does not allow this action.',
        },
      });
      expect(visibleText(html)).toContain('Your response was not saved');
      expect(visibleText(html)).toContain(
        'Your role on this experiment does not allow this action.',
      );
      expect(html.match(/Your response was not saved/gu)).toHaveLength(1);
    });

    it('shows no form to someone who may not respond, and says who may', () => {
      const html = render({
        view: viewFixture({ ...populated(), may: { run: true, respond: false } }),
      });
      expect(html).not.toContain('<form');
      expect(html).not.toContain('<textarea');
      expect(visibleText(html)).toContain(
        'Only someone who can edit this experiment can respond to a criticism',
      );
      // What was said is still shown to them.
      expect(visibleText(html)).toContain('The conclusion could be wrong');
    });
  });

  describe('a comparison that cannot say anything about the change', () => {
    const OBJECTION =
      'No stakeholder has an expected direction of impact, so the change cannot move anyone in the simulation and every difference from no change is noise.';
    const ACTION =
      'Say who is helped or harmed in the stakeholder review, or read the evidence with a model, before reading anything into the results.';
    const lead = (change: Parameters<typeof critiqueFixture>[0] = {}) =>
      critiqueFixture({
        id: CHANGE_CANNOT_MOVE_ID,
        role: 'methodology',
        severity: 'major',
        objection: OBJECTION,
        basis: ['Actors with an expected direction of impact: 0 of 25.'],
        impactOnConclusion:
          'If this stands, nothing in this comparison is about the change, and the conclusions do not follow.',
        requestedAction: ACTION,
        ...change,
      });
    const others = () => [
      critiqueFixture({
        id: 'evidence-single-source',
        role: 'evidence',
        severity: 'major',
        objection: 'Most cited passages come from one document.',
      }),
      critiqueFixture(),
    ];
    const vacuous = (change: Parameters<typeof critiqueFixture>[0] = {}) =>
      viewFixture({ critiques: setFixture([...others(), lead(change)]) });

    it('leads the page with it, above the run controls, the summary and every critic', () => {
      const html = render({ view: vacuous() });
      const at = (text: string) => html.indexOf(text);
      expect(at('Read this first')).toBeGreaterThan(-1);
      expect(at(LEAD_HEADING)).toBeGreaterThan(-1);
      expect(at(LEAD_HEADING)).toBeLessThan(at('Run the review again'));
      expect(at(LEAD_HEADING)).toBeLessThan(at('What the review found'));
      expect(at(LEAD_HEADING)).toBeLessThan(at(CRITIC_ROLE_QUESTIONS.evidence));
      expect(at(LEAD_HEADING)).toBeLessThan(at(CRITIC_ROLE_QUESTIONS.methodology));
      const text = visibleText(html);
      expect(text).toContain(LEAD_EXPLANATION);
      expect(text).toContain('read nothing into these results');
    });

    it('says what is wrong, what it rests on and what it does to the conclusion', () => {
      const text = visibleText(render({ view: vacuous() }));
      expect(text).toContain(OBJECTION);
      expect(text).toContain('Actors with an expected direction of impact: 0 of 25.');
      expect(text).toContain('and the conclusions do not follow');
      expect(text).toContain('Major');
    });

    it('asks for the action it requests, in a row of its own', () => {
      const html = render({ view: vacuous() });
      expect(html).toContain('class="critic-action"');
      expect(visibleText(html)).toContain(`Requested action ${ACTION}`);
    });

    it('shows it once: it is not repeated in the group of the critic that raised it', () => {
      const html = render({ view: vacuous() });
      expect(html.split(OBJECTION)).toHaveLength(2);
      expect(html.split('critic-lead"')).toHaveLength(2);
      // The other methodology criticism is still in its group.
      const headings = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gu)].map((m) =>
        visibleText(m[1] ?? ''),
      );
      expect(headings).toContain(CRITIC_ROLE_QUESTIONS.methodology);
    });

    it('leaves out a critic whose only criticism is the lead', () => {
      const html = render({ view: viewFixture({ critiques: setFixture([lead()]) }) });
      const headings = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gu)].map((m) =>
        visibleText(m[1] ?? ''),
      );
      expect(headings).toContain(LEAD_HEADING);
      expect(headings).not.toContain(CRITIC_ROLE_QUESTIONS.methodology);
    });

    it('counts it with the others, and keeps one response form on it', () => {
      const html = render({ view: vacuous() });
      const text = visibleText(html);
      expect(text).toContain('3 criticisms raised against this analysis');
      const severities =
        html.match(/<ul[^>]*aria-label="Criticisms by severity"[\s\S]*?<\/ul>/u)?.[0] ?? '';
      expect(visibleText(severities)).toBe('Blocking 0 Major 2 Minor 1 Note 0');
      expect(html.match(/<form/gu)).toHaveLength(3);
      expect(html.match(/aria-label="Respond to: The analysis as a whole"/gu)).toHaveLength(3);
    });

    it('keeps it on top once it is accepted, with what was said', () => {
      const html = render({
        view: vacuous({
          status: 'accepted',
          response: {
            text: 'We will say who is helped or harmed first.',
            by: 'user',
            at: '2026-02-03T10:00:00.000Z',
          },
        }),
      });
      const text = visibleText(html);
      expect(html.indexOf(LEAD_HEADING)).toBeLessThan(html.indexOf('What the review found'));
      expect(text).toContain('Accepted: this applies to the conclusion');
      expect(text).toContain('We will say who is helped or harmed first.');
    });

    it('is still shown to someone who may not respond, without a form', () => {
      const html = render({
        view: viewFixture({
          critiques: setFixture([lead()]),
          may: { run: true, respond: false },
        }),
      });
      expect(visibleText(html)).toContain(LEAD_HEADING);
      expect(visibleText(html)).toContain(OBJECTION);
      expect(html).not.toContain('<form');
    });

    it('says nothing of the kind where the review does not hold it', () => {
      const text = visibleText(render({ view: populated() }));
      expect(text).not.toContain('Read this first');
      expect(text).not.toContain(LEAD_HEADING);
      expect(text).not.toContain('Requested action');
    });

    it('shows a requested action on any criticism that has one, and on no other', () => {
      const html = render({
        view: viewFixture({
          critiques: setFixture([
            critiqueFixture({
              id: 'assumption-no-registered-effect',
              role: 'assumption',
              severity: 'major',
              target: { kind: 'finding', id: 'f1' },
              objection: 'The comparison found no repeatable difference from no change.',
              requestedAction:
                'Raise the intensity of the change, or check the impact each actor is given, then compare again.',
            }),
            critiqueFixture(),
          ]),
        }),
      });
      expect(html.match(/class="critic-action"/gu)).toHaveLength(1);
      expect(visibleText(html)).toContain('Raise the intensity of the change');
      expect(html).not.toContain('Read this first');
    });
  });

  describe('structure and copy', () => {
    it('has a heading outline that never skips a level, and names each card by what it is about', () => {
      const html = render({ view: populated() });
      const levels = [...html.matchAll(/<h([1-6])[ >]/gu)].map((m) => Number(m[1]));
      expect(levels[0]).toBe(2);
      for (let i = 1; i < levels.length; i += 1) {
        expect(levels[i]!, `heading ${i}`).toBeLessThanOrEqual(levels[i - 1]! + 1);
      }
      for (const [, id] of html.matchAll(/<article[^>]*aria-labelledby="([^"]+)"/gu)) {
        expect(html, id).toContain(`id="${id}"`);
      }
    });

    it('never writes a markup sink, a secret-looking value or an endpoint into the page', () => {
      const html = render({ view: populated() });
      expectNoSecretLikeText(visibleText(html));
      expect(html).not.toMatch(/dangerouslySetInnerHTML|<script/u);
    });

    it('treats what a critic wrote as text, not markup', () => {
      const html = render({
        view: viewFixture({
          critiques: setFixture([
            critiqueFixture({
              objection: '<img src=x onerror=alert(1)> is not markup',
              basis: ['<b>bold</b>'],
            }),
          ]),
        }),
      });
      expect(html).not.toContain('<img');
      expect(html).not.toContain('<b>bold');
      expect(html).toContain('&lt;img');
    });

    it('promises nothing it cannot keep: no prediction, no rate presented as real', () => {
      const text = visibleText(render({ view: viewFixture({ critiques: null }) }));
      const claims = text.replace(
        'does not guarantee or precisely predict real-world behaviour',
        '',
      );
      expect(claims).not.toMatch(/\bwill\b/iu);
      expect(claims).not.toMatch(/\d\s?%/u);
      expect(claims).not.toMatch(/\b(?:guarantee|certainly|proves?)\b/iu);
    });
  });

  it('reads nothing while it renders: the panel says that it is reading until the server answers', () => {
    const html = renderToStaticMarkup(<CriticPanel project={projectFixture()} />);
    expect(visibleText(html)).toContain('Reading the independent review');
  });
});
