import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { scenarioFixture } from '../../../../shared/lab-fixtures';
import type { ScenarioFrame } from '../../../../shared/scenario';
import { scenarioApi } from '../../api/scenario';
import { visibleText } from '../../test/provider';
import { IntakeEditor } from './IntakeEditor';
import { IntakeSummary } from './IntakeParts';
import { IntakePrompt } from './IntakePrompt';
import { IntakeQuestions } from './IntakeQuestions';
import { IntakeReview } from './IntakeReview';
import { ScenarioIntake } from './ScenarioIntake';

const noop = () => undefined;

/** What a reading by rules gives, with three questions back. */
const read = (overrides: Partial<ScenarioFrame> = {}): ScenarioFrame => ({
  ...scenarioFixture({
    origin: 'rules',
    evidenceAvailable: ['survey.md (1,200 characters)'],
    evidenceMissing: ['How groups reacted to similar changes.'],
    assumptions: [{ id: 'face-value', text: 'The change happens as described.', origin: 'system' }],
    ambiguities: [
      { field: 'horizon', message: 'No period was stated.', question: 'Over what period?' },
      { field: 'success', message: 'No measure was stated.', question: 'What is a good outcome?' },
    ],
  }),
  ...overrides,
});

const review = (props: Partial<Parameters<typeof IntakeReview>[0]> = {}) =>
  renderToStaticMarkup(
    <IntakeReview
      frame={read()}
      mode="rules"
      model={null}
      notes={['Read by rules, not a model. Check every field.']}
      stale={false}
      problems={[]}
      disabled={false}
      onChange={noop}
      onUse={noop}
      onDiscard={noop}
      {...props}
    />,
  );

describe('before a question has been read', () => {
  it('invites the person to read it, says it is optional and that nothing runs, and calls nothing', () => {
    const parse = vi.spyOn(scenarioApi, 'parse');
    const html = renderToStaticMarkup(
      <ScenarioIntake
        question="What could happen if the rate changes?"
        frame={null}
        onFrame={noop}
        disabled={false}
      />,
    );
    const text = visibleText(html);
    expect(text).toContain('Understand my question');
    expect(text).toContain('(optional)');
    expect(text).toContain('Nothing runs until you start the experiment');
    expect(text).toContain('you can skip this step');
    expect(html).toMatch(/<button type="button" class="button button-primary"(?![^>]*disabled)/u);
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
  });

  it('is nested in a form without being able to submit it: no form of its own, and buttons that are not submit buttons', () => {
    for (const html of [
      renderToStaticMarkup(
        <ScenarioIntake
          question="What could happen?"
          frame={null}
          onFrame={noop}
          disabled={false}
        />,
      ),
      review(),
      renderToStaticMarkup(
        <ScenarioIntake question="x" frame={scenarioFixture()} onFrame={noop} disabled={false} />,
      ),
    ]) {
      expect(html).not.toContain('<form');
      expect(html).not.toContain('type="submit"');
      for (const button of html.match(/<button\b[^>]*>/gu) ?? []) {
        expect(button, button).toContain('type="button"');
      }
    }
  });

  it('asks for a longer question first, and says how long', () => {
    const html = renderToStaticMarkup(
      <ScenarioIntake question="short" frame={null} onFrame={noop} disabled={false} />,
    );
    expect(html).toMatch(/class="button button-primary"[^>]*disabled/u);
    expect(visibleText(html)).toContain('Write your question above first: at least 10 characters.');
  });

  it('can be switched off while the page is busy', () => {
    const html = renderToStaticMarkup(
      <ScenarioIntake
        question="What could happen if the rate changes?"
        frame={null}
        onFrame={noop}
        disabled
      />,
    );
    expect(html).toMatch(/class="button button-primary"[^>]*disabled/u);
  });

  it('says it is reading, and offers to stop', () => {
    const html = renderToStaticMarkup(
      <IntakePrompt ready reading error={null} disabled={false} onRead={noop} onCancel={noop} />,
    );
    expect(html).toContain('aria-busy="true"');
    expect(visibleText(html)).toContain('Reading your question…');
    expect(visibleText(html)).toContain('Cancel');
    expect(html).toContain('aria-live="polite"');
  });

  it('shows why a reading failed, as an alert, and says that the person can carry on', () => {
    const html = renderToStaticMarkup(
      <IntakePrompt
        ready
        reading={false}
        error="The server took too long to respond. Try again."
        disabled={false}
        onRead={noop}
        onCancel={noop}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(visibleText(html)).toContain('The server took too long to respond. Try again.');
    expect(visibleText(html)).toContain('You can carry on without a scenario.');
  });
});

describe('a scenario waiting to be checked', () => {
  it('says how it was read, in words, and shows what the reading noted', () => {
    const text = visibleText(review());
    expect(text).toContain('Check and edit the scenario');
    expect(text).toContain('Read by rules, not a model');
    expect(text).toContain('Read by rules, not a model. Check every field.');
    expect(text).toContain('Nothing runs yet');
  });

  it('names the model that read it, when one did, and calls an edited scenario the person’s', () => {
    const model = visibleText(
      review({ frame: read({ origin: 'model' }), mode: 'model', model: 'gpt-fixture' }),
    );
    expect(model).toContain('Read by a model');
    expect(model).toContain('gpt-fixture');
    expect(visibleText(review({ frame: read({ origin: 'user' }), mode: 'rules' }))).toContain(
      'Edited by you',
    );
  });

  it('shows each thing that was left open with its one question and a place to answer', () => {
    const html = review();
    expect(visibleText(html)).toContain('Things the question left open');
    expect(html).toMatch(/<label[^>]*>Over what period\?<\/label>/u);
    expect(html).toMatch(/<label[^>]*>What is a good outcome\?<\/label>/u);
    expect(html.match(/Apply my answer/gu)).toHaveLength(2);
    expect(html.match(/Skip this question/gu)).toHaveLength(2);
    // Nothing to apply until something is typed.
    expect(html.match(/Apply my answer/gu)?.length).toBe(
      (html.match(/<button[^>]*disabled[^>]*>\s*Apply my answer/gu) ?? []).length,
    );
  });

  it('shows no questions section when none were left open', () => {
    expect(visibleText(review({ frame: read({ ambiguities: [] }) }))).not.toContain('left open');
    expect(
      renderToStaticMarkup(<IntakeQuestions questions={[]} onAnswer={noop} onSkip={noop} />),
    ).toBe('');
  });

  it('puts every part of the scenario in a labelled control, with the limit of its size', () => {
    const html = review();
    for (const label of [
      'Decision or event',
      'What is affected',
      'Where (optional)',
      'Over what period (optional)',
      'What is expected if nothing changes',
      'Name of change 1',
      'From',
      'To',
      'Note (optional)',
      'Name',
      'Description (optional)',
      'The decision to make',
      'The result you want',
    ]) {
      expect(html, label).toMatch(
        new RegExp(`<label[^>]*>${label.replace(/[()]/gu, '\\$&')}`, 'u'),
      );
    }
    const frame = read();
    expect(html).toContain(`>${frame.decision}</textarea>`);
    expect(html).toMatch(
      /id="[^"]*-decision"[^>]*maxLength="400"|maxLength="400"[^>]*id="[^"]*-decision"/u,
    );
    expect(html).toContain(`value="${frame.system}"`);
    expect(html).toContain(`value="${frame.geography}"`);
    expect(html).toContain(`value="${frame.changes[0]?.name}"`);
    expect(html).toContain('aria-required="true"');
    // Every input has a label that a screen reader finds.
    const inputs = html.match(/<(?:input|textarea)\b[^>]*\bid="([^"]+)"/gu) ?? [];
    expect(inputs.length).toBeGreaterThan(10);
    for (const input of inputs) {
      const id = /id="([^"]+)"/u.exec(input)?.[1] ?? '';
      expect(html, id).toContain(`for="${id}"`);
    }
  });

  it('lets rows be added to and taken from, and names each control by its row', () => {
    const html = review();
    expect(html).toContain('aria-label="change 1"');
    expect(html).toContain(`aria-label="Remove change 1: ${read().changes[0]?.name}"`);
    expect(html).toContain('aria-label="Alternative 1"');
    expect(html).toContain('aria-label="Remove alternative 1: Smaller rise"');
    expect(html).toContain('aria-label="Remove group 1: subscribers"');
    expect(html).toContain('aria-label="Remove assumption 1"');
    for (const add of [
      'Add a change',
      'Add an alternative',
      'Add a group',
      'Add a prompt',
      'Add an assumption',
    ]) {
      expect(visibleText(html), add).toContain(add);
    }
  });

  it('says what is assumed, and by whom', () => {
    const text = visibleText(review());
    expect(text).toContain('Assumed by Swarm');
    expect(
      visibleText(
        review({ frame: read({ assumptions: [{ id: 'a', text: 'Mine.', origin: 'user' }] }) }),
      ),
    ).toContain('Your assumption');
  });

  it('lists the evidence that was attached, and the general prompts, with the honest caveat', () => {
    const html = review();
    const text = visibleText(html);
    expect(text).toContain('Evidence you attached');
    expect(text).toContain('survey.md (1,200 characters)');
    // A prompt is in a box the person can edit, so it is the box's value.
    expect(html).toContain('value="How groups reacted to similar changes."');
    expect(text).toContain('Swarm cannot tell from the question whether your documents cover them');
    expect(visibleText(review({ frame: read({ evidenceAvailable: [] }) }))).toContain(
      'No documents were attached when the question was read.',
    );
  });

  it('says plainly when a list is empty', () => {
    const text = visibleText(
      review({
        frame: read({
          changes: [],
          alternatives: [],
          likelyStakeholders: [],
          evidenceMissing: [],
          assumptions: [],
          ambiguities: [],
        }),
      }),
    );
    for (const phrase of [
      'No changes listed.',
      'No alternatives listed.',
      'No groups listed.',
      'No prompts listed.',
      'No assumptions listed.',
    ]) {
      expect(text, phrase).toContain(phrase);
    }
  });

  it('offers to use or drop the scenario, and says what that means', () => {
    const text = visibleText(review());
    expect(text).toContain('Use this scenario');
    expect(text).toContain('Discard');
    expect(text).toContain('If you do not use it, the experiment starts from your question alone.');
  });

  it('shows what must be put right before it can be used, as an alert', () => {
    const html = review({ problems: ['Say what decision or event you want to explore.'] });
    expect(html).toContain('role="alert"');
    expect(visibleText(html)).toContain('This scenario cannot be used yet');
    expect(visibleText(html)).toContain('Say what decision or event you want to explore.');
    expect(visibleText(review())).not.toContain('cannot be used yet');
  });

  it('says when the question has changed since it was read', () => {
    expect(visibleText(review({ stale: true }))).toContain(
      'The question has changed since it was read',
    );
    expect(visibleText(review())).not.toContain('has changed since');
  });

  it('can be switched off, every control with it', () => {
    const html = review({ disabled: true });
    // Every group of fields is disabled, which disables the controls in it, and so is every button
    // and every box for an answer that is outside one.
    const fieldsets = html.match(/<fieldset\b[^>]*>/gu) ?? [];
    expect(fieldsets.length).toBeGreaterThan(4);
    for (const fieldset of fieldsets) expect(fieldset).toContain('disabled=""');
    const buttons = html.match(/<button\b[^>]*>/gu) ?? [];
    expect(buttons.length).toBeGreaterThan(8);
    for (const button of buttons) expect(button).toContain('disabled=""');
    expect(html).toMatch(
      /<input[^>]*type="text"[^>]*disabled=""[^>]*aria-describedby="[^"]*-message"/u,
    );
  });

  it('shows text from a reading as text, never as markup', () => {
    const hostile = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const html = review({
      frame: read({
        decision: hostile,
        system: hostile,
        changes: [{ name: hostile, from: hostile, to: hostile, note: hostile }],
        likelyStakeholders: [hostile],
      }),
      notes: [hostile],
    });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('a scenario that will be used', () => {
  const summary = (props: Partial<Parameters<typeof IntakeSummary>[0]> = {}) =>
    renderToStaticMarkup(
      <IntakeSummary
        frame={read()}
        stale={false}
        disabled={false}
        onEdit={noop}
        onRemove={noop}
        {...props}
      />,
    );

  it('shows the decision and what the scenario holds, and the ways to change or drop it', () => {
    const text = visibleText(summary());
    expect(text).toContain('This scenario will be used');
    expect(text).toContain(read().decision);
    expect(text).toContain('Affects: A subscription service and the groups around it');
    expect(text).toContain('Where: One region');
    expect(text).toContain('Period: The next two quarters');
    expect(text).toContain('1 change');
    expect(text).toContain('1 alternative');
    expect(text).toContain('3 groups likely to be affected');
    expect(text).toContain('Read by rules, not a model');
    expect(text).toContain('Edit the scenario');
    expect(text).toContain('Do not use a scenario');
  });

  it('is what the page shows when it already holds a scenario', () => {
    const html = renderToStaticMarkup(
      <ScenarioIntake
        question="Another question entirely"
        frame={read()}
        onFrame={noop}
        disabled={false}
      />,
    );
    expect(visibleText(html)).toContain('This scenario will be used');
    expect(visibleText(html)).not.toContain('The question has changed');
  });

  it('says when the question has changed since, and when the page is busy', () => {
    expect(visibleText(summary({ stale: true }))).toContain(
      'The question has changed since it was read',
    );
    expect(summary({ disabled: true }).match(/<button[^>]*disabled/gu)).toHaveLength(2);
  });
});

describe('the editor on its own', () => {
  it('renders a scenario with nothing in it, and one at the limits, without trouble', () => {
    const empty = renderToStaticMarkup(
      <IntakeEditor
        frame={{
          decision: '',
          system: '',
          geography: null,
          horizon: null,
          changes: [],
          baseline: '',
          alternatives: [],
          requestedDecision: null,
          desiredOutput: null,
          evidenceAvailable: [],
          evidenceMissing: [],
          assumptions: [],
          likelyStakeholders: [],
          ambiguities: [],
          origin: 'user',
        }}
        onChange={noop}
      />,
    );
    expect(visibleText(empty)).toContain('Decision or event');
    const full = renderToStaticMarkup(
      <IntakeEditor
        frame={read({
          changes: Array.from({ length: 10 }, (_, n) => ({
            name: `c${n}`,
            from: null,
            to: null,
            note: '',
          })),
          likelyStakeholders: Array.from({ length: 20 }, (_, n) => `g${n}`),
        })}
        onChange={noop}
      />,
    );
    // Nothing more can be added to a list that is full.
    expect(full).toMatch(/<button[^>]*disabled[^>]*>\s*(?:<svg[^>]*>.*?<\/svg>)\s*Add a change/u);
    expect(full).toMatch(/<button[^>]*disabled[^>]*>\s*(?:<svg[^>]*>.*?<\/svg>)\s*Add a group/u);
  });
});
