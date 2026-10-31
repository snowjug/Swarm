import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EvidenceRef } from '../../../../shared/evidence';
import {
  FIXTURE_TIME,
  actorFixture,
  actorSetFixture,
  stakeholderFixture,
  stakeholderSetFixture,
} from '../../../../shared/lab-fixtures';
import type {
  Actor,
  ActorsView,
  StakeholderSet,
  StakeholdersView,
} from '../../../../shared/stakeholders';
import type { StakeholderState } from '../../hooks/useStakeholders';
import { projectFixture } from '../../test/project';
import { expectNoSecretLikeText, visibleText } from '../../test/provider';
import { StakeholderPanel } from './StakeholderPanel';
import { StakeholderForm } from './StakeholderForm';
import { StakeholderWorkspace } from './StakeholderWorkspace';
import { EMPTY_DRAFT } from './review';

afterEach(() => vi.unstubAllGlobals());

const NO_MODEL = { available: false, reason: 'No model is set up for this project.' };
const A_MODEL = { available: true, reason: null };
const MAY = { edit: true, run: true };
const READ_ONLY = { edit: false, run: false };

const view = (patch: Partial<StakeholdersView> = {}): StakeholdersView => ({
  stakeholders: null,
  revision: null,
  model: NO_MODEL,
  may: MAY,
  ...patch,
});

const state = (patch: Partial<StakeholderState> = {}): StakeholderState => ({
  view: view(),
  actors: null,
  loading: false,
  error: null,
  working: null,
  problem: null,
  reload: () => undefined,
  dismissProblem: () => undefined,
  discover: async () => true,
  save: async () => true,
  approve: async () => true,
  makeActors: async () => true,
  saveActors: async () => true,
  ...patch,
});

const set = (patch: Partial<StakeholderSet> = {}): StakeholderSet => ({
  ...stakeholderSetFixture(),
  approvedAt: null,
  ...patch,
});

/** A project with a set of stakeholders, and the rest of the state as given. */
const withSet = (
  patch: Partial<StakeholderSet> = {},
  rest: Partial<StakeholderState> = {},
  seen: Partial<StakeholdersView> = {},
): StakeholderState =>
  state({ view: view({ stakeholders: set(patch), revision: 1, ...seen }), ...rest });

const actorsView = (patch: Partial<ActorsView> = {}): ActorsView => ({
  actors: actorSetFixture(),
  revision: 2,
  stale: false,
  model: NO_MODEL,
  may: MAY,
  ...patch,
});

const html = (current: StakeholderState) =>
  renderToStaticMarkup(<StakeholderWorkspace state={current} />);
const text = (current: StakeholderState) => visibleText(html(current));

const ref = (passageId: string, quote: string): EvidenceRef => ({
  passageId,
  documentId: 'D1',
  documentName: 'notes.md',
  start: 0,
  end: quote.length,
  quote,
  contentHash: `hash-${passageId}`,
  role: 'supports',
});

/** Whether a button with this name is there, and is switched off. */
function buttonNamed(markup: string, name: string): { found: boolean; disabled: boolean } {
  for (const button of markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gu)) {
    if (visibleText(button[2] ?? '').includes(name)) {
      return { found: true, disabled: /\sdisabled(?:=""|\s|$)/u.test(button[1] ?? '') };
    }
  }
  return { found: false, disabled: false };
}

/** Every button and form control has a name a screen reader can say. */
function expectNamedControls(markup: string): void {
  const labelled = new Set(
    [...markup.matchAll(/<label\b[^>]*\sfor="([^"]+)"/gu)].map((match) => match[1]),
  );
  for (const control of markup.matchAll(/<(?:input|select|textarea)\b[^>]*>/gu)) {
    const tag = control[0];
    const id = /\sid="([^"]+)"/u.exec(tag)?.[1];
    const named = /\saria-label="[^"]+"/u.test(tag) || (id !== undefined && labelled.has(id));
    expect(named, `a control has no name: ${tag}`).toBe(true);
  }
  for (const button of markup.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gu)) {
    const named = visibleText(button[1] ?? '') !== '' || /\saria-label="[^"]+"/u.test(button[0]);
    expect(named, `a button has no name: ${button[0]}`).toBe(true);
  }
}

describe('before there is anything to show', () => {
  it('says it is reading while the first answer is awaited, and offers nothing yet', () => {
    const markup = html(state({ view: null, loading: true }));
    const shown = visibleText(markup);
    expect(shown).toContain('Stakeholders and actors');
    expect(shown).toContain('Reading stakeholders…');
    expect(markup).toContain('role="status"');
    expect(shown).not.toContain('Find stakeholders');
  });

  it('says why it could not read, in words, and offers a retry', () => {
    const markup = html(state({ view: null, error: 'Cannot reach the local server.' }));
    const shown = visibleText(markup);
    expect(shown).toContain('Stakeholders could not be read');
    expect(shown).toContain('Cannot reach the local server.');
    expect(buttonNamed(markup, 'Retry').found).toBe(true);
    expect(markup).toContain('role="alert"');
  });

  it('shows an empty state, not an error, when there is neither a view nor a reason', () => {
    expect(text(state({ view: null }))).toContain('No stakeholders to show');
  });

  it('renders the connected panel without asking the server for anything', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const shown = visibleText(
      renderToStaticMarkup(
        <StakeholderPanel project={projectFixture()} onChanged={() => undefined} />,
      ),
    );
    expect(shown).toContain('Reading stakeholders…');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('a project that has not been asked for its stakeholders', () => {
  it('says first that the actors are synthetic and that Swarm does not predict real people', () => {
    const shown = text(state());
    expect(shown).toContain('not real people');
    expect(shown).toContain('every number they carry is a modelling assumption you can change');
    expect(shown).toContain('it does not predict what real people will do');
    expect(shown.indexOf('not real people')).toBeLessThan(
      shown.indexOf('Find stakeholders by reading the text'),
    );
  });

  it('offers the reading of the text when no model is available, says what it cannot do, and says why there is no model', () => {
    const markup = html(state());
    const shown = visibleText(markup);
    expect(buttonNamed(markup, 'Find stakeholders by reading the text')).toEqual({
      found: true,
      disabled: false,
    });
    expect(buttonNamed(markup, 'Find stakeholders with the model').found).toBe(false);
    expect(shown).toContain('No model is used');
    expect(shown).toContain('it will miss groups it has no word for');
    expect(shown).toContain('Not available here: No model is set up for this project.');
    expect(buttonNamed(markup, 'Or add stakeholders yourself').found).toBe(true);
    expectNoSecretLikeText(shown);
  });

  it('offers the model too when one is available, and says what is sent and what happens if it fails', () => {
    const markup = html(state({ view: view({ model: A_MODEL }) }));
    const shown = visibleText(markup);
    expect(buttonNamed(markup, 'Find stakeholders with the model').found).toBe(true);
    expect(shown).toContain('Sends your source text to the model');
    expect(shown).toContain('one it cannot find is dropped');
    expect(shown).toContain(
      'If the model fails, Swarm reads the text for roles instead and says so',
    );
    expect(shown).not.toContain('Not available here');
  });

  it('lets a person who may only read see that they cannot run it, and offers them no way to change anything', () => {
    const markup = html(state({ view: view({ may: READ_ONLY }) }));
    expect(visibleText(markup)).toContain('You can read the stakeholders but not run this');
    expect(buttonNamed(markup, 'Find stakeholders').found).toBe(false);
    expect(buttonNamed(markup, 'Or add stakeholders yourself').found).toBe(false);
  });

  it('keeps the buttons named for a screen reader', () => {
    expectNamedControls(html(state({ view: view({ model: A_MODEL }) })));
  });
});

describe('a set found by reading the text', () => {
  it('says how it was found, counts what is there, and groups it by category in words', () => {
    const shown = text(withSet());
    expect(shown).toContain('Found by reading the text, not by a model');
    expect(shown).toContain('5 stakeholders (3 key). 5 proposed.');
    for (const heading of ['Decision maker', 'Bears cost', 'Competitor', 'Regulator', 'Partner']) {
      expect(shown, heading).toContain(heading);
    }
    expect(shown).toContain('Subscribers');
    expect(shown).toContain('Rival provider');
  });

  it('shows a size as an assumption and a key actor as one actor, and never as a count of people', () => {
    const shown = text(withSet());
    expect(shown).toContain('Stands for about 5,000 (a modelling assumption, not a count)');
    expect(shown).toContain('Modelled as one actor');
    expect(shown).not.toMatch(/\b5,000 (?:people|customers|users)\b/u);
  });

  it('shows what is known and what is not: priority, directness, uncertainty, who found it, impact and why', () => {
    const shown = text(withSet());
    expect(shown).toContain('Key actor');
    expect(shown).toContain('Standard cohort');
    expect(shown).toContain('Direct');
    expect(shown).toContain('Uncertainty: medium');
    expect(shown).toContain('Found by reading the text');
    expect(shown).toContain('Expected impact: Harmed');
    expect(shown).toContain('assumption');
    expect(shown).toContain('Why it matters:');
    expect(shown).toContain('No quote was kept for this stakeholder.');
  });

  it('offers accept, edit, merge, remove and a priority on each stakeholder, each named for what it acts on', () => {
    const markup = html(withSet());
    const shown = visibleText(markup);
    for (const name of ['Provider', 'Subscribers', 'Regulator']) {
      for (const verb of ['Accept', 'Edit', 'Merge', 'Remove']) {
        expect(shown, `${verb} ${name}`).toContain(`${verb} ${name}`);
      }
    }
    expect(shown).toContain('Priority');
    expect(buttonNamed(markup, 'Add a stakeholder').found).toBe(true);
    expectNamedControls(markup);
  });

  it('says that approving makes actors, and how many proposed stakeholders it will accept', () => {
    const markup = html(withSet());
    const shown = visibleText(markup);
    expect(shown).toContain('Approve and create actors');
    expect(shown).toContain('5 stakeholders still only proposed will be accepted.');
    expect(shown).toContain(
      'starting every trait from a documented category prior that you can change',
    );
    expect(buttonNamed(markup, 'Approve stakeholders and create actors')).toEqual({
      found: true,
      disabled: false,
    });
    expect(shown).not.toContain('Approved ');
  });

  it('will not approve fewer than two stakeholders, and says why', () => {
    const markup = html(
      withSet({
        stakeholders: [
          stakeholderFixture('one', 'cost-bearer'),
          stakeholderFixture('two', 'other', { status: 'removed' }),
        ],
        relations: [],
      }),
    );
    expect(buttonNamed(markup, 'Approve stakeholders and create actors').disabled).toBe(true);
    expect(visibleText(markup)).toContain('Keep or add at least two stakeholders');
  });

  it('offers to let the model read the key actors only where a model is available, and says what that sends', () => {
    const without = visibleText(html(withSet()));
    expect(without).not.toContain('Let the model read the key actors');
    const withModel = visibleText(html(withSet({}, {}, { model: A_MODEL })));
    expect(withModel).toContain('Let the model read the key actors against the evidence');
    expect(withModel).toContain('It sends your source text to the model');
    expect(withModel).toContain('if it fails the category priors stand');
  });
});

describe('perspectives that may be missing', () => {
  it('asks who might be missing as a prompt, not an error, with a way to add them', () => {
    const markup = html(withSet({ gaps: ['substitute', 'channel', 'a named role'] }));
    const shown = visibleText(markup);
    expect(shown).toContain('Perspectives that may be missing');
    expect(shown).toContain('Nobody was found for: substitute, channel, a named role.');
    expect(shown).toContain('These are prompts, not errors');
    expect(shown.match(/Add a stakeholder/gu)).toHaveLength(2);
    expect(markup).not.toContain('notice-error');
  });

  it('shows nothing about gaps when there are none, and no way to add one to someone who may not edit', () => {
    expect(text(withSet({ gaps: [] }))).not.toContain('Perspectives that may be missing');
    const readOnly = text(withSet({ gaps: ['channel'] }, {}, { may: READ_ONLY }));
    expect(readOnly).toContain('Nobody was found for: channel.');
    expect(readOnly).not.toContain('Add a stakeholder');
  });
});

describe('a set found by a model', () => {
  const modelSet: Partial<StakeholderSet> = {
    discovery: {
      mode: 'model',
      model: 'fixture-model',
      generatedAt: FIXTURE_TIME,
      note: 'Quotes the model gave were checked against your sources; 1 could not be found and was dropped.',
    },
    stakeholders: [
      stakeholderFixture('regulators', 'regulator', {
        origin: 'model',
        priority: 'key',
        evidence: [ref('S1', 'Regulators require notice before processing begins.')],
      }),
      stakeholderFixture('neighbours', 'risk-bearer', { origin: 'model', evidence: [] }),
    ],
    relations: [],
  };

  it('names the model, shows each quote word for word with its passage, and calls an unquoted one inferred', () => {
    const markup = html(withSet(modelSet));
    const shown = visibleText(markup);
    expect(shown).toContain('Found by a model (fixture-model)');
    expect(shown).toContain('Proposed by a model');
    expect(shown).toContain('Model, inferred');
    expect(shown).toContain('Evidence (1)');
    expect(shown).toContain('“Regulators require notice before processing begins.”');
    expect(shown).toContain('S1 · notes.md');
    expect(shown).toContain(
      'Inferred by the model: it could not quote a passage that supports this stakeholder.',
    );
    expect(shown).toContain('Quotes the model gave were checked against your sources');
    expect(markup).toContain('notice-info');
  });

  it('says plainly, as a warning, when the model could not be used and the text was read instead', () => {
    const markup = html(
      withSet({
        discovery: {
          mode: 'rules',
          model: null,
          generatedAt: FIXTURE_TIME,
          note: 'The model could not be used (it did not answer in time). Stakeholders were found by reading the text instead.',
        },
      }),
    );
    const shown = visibleText(markup);
    expect(shown).toContain('How these were found');
    expect(shown).toContain('The model could not be used');
    expect(shown).toContain('Found by reading the text, not by a model');
    expect(markup).toContain('notice-warning');
  });

  it('says when the person built the list by hand', () => {
    expect(
      text(
        withSet({
          discovery: {
            mode: 'user',
            model: null,
            generatedAt: FIXTURE_TIME,
            note: 'Added by hand; nothing was discovered.',
          },
        }),
      ),
    ).toContain('Built by you');
  });
});

describe('removing, merging and reading only', () => {
  it('keeps a removed stakeholder in the record, out of the count, with a way to bring it back', () => {
    const base = stakeholderSetFixture().stakeholders;
    const markup = html(
      withSet({
        stakeholders: base.map((item) =>
          item.id === 'resellers' ? { ...item, status: 'removed' as const } : item,
        ),
      }),
    );
    const shown = visibleText(markup);
    expect(shown).toContain('4 stakeholders (3 key). 4 proposed, 1 removed.');
    expect(shown).toContain('Removed 1');
    expect(shown).toContain('Any of them can be restored.');
    expect(buttonNamed(markup, 'Restore Resellers').found).toBe(true);
    expect(buttonNamed(markup, 'Accept Resellers').found).toBe(false);
  });

  it('shows where a merged stakeholder went, and offers to undo that rather than a restore that would be refused', () => {
    const base = stakeholderSetFixture().stakeholders;
    const markup = html(
      withSet({
        stakeholders: base.map((item) =>
          item.id === 'resellers'
            ? { ...item, status: 'removed' as const }
            : item.id === 'provider'
              ? { ...item, mergedFrom: ['resellers'], status: 'edited' as const }
              : item,
        ),
      }),
    );
    const shown = visibleText(markup);
    expect(shown).toContain('Merged from 1 other stakeholder(s)');
    expect(shown).toContain('Merged into Provider. It stays in the record.');
    expect(buttonNamed(markup, 'Undo the merge of Resellers').found).toBe(true);
    expect(buttonNamed(markup, 'Restore Resellers').found).toBe(false);
  });

  it('shows a person who may only read everything the others see and none of the means to change it', () => {
    const markup = html(
      withSet(
        {
          stakeholders: [
            stakeholderFixture('regulators', 'regulator', {
              evidence: [ref('S1', 'Regulators require notice.')],
            }),
            stakeholderFixture('customers', 'cost-bearer'),
          ],
          relations: [],
          approvedAt: null,
        },
        { actors: actorsView({ may: READ_ONLY }) },
        { may: READ_ONLY },
      ),
    );
    const shown = visibleText(markup);
    expect(shown).toContain('“Regulators require notice.”');
    for (const word of ['Accept', 'Edit Regulators', 'Merge', 'Remove', 'Add a stakeholder']) {
      expect(shown, word).not.toContain(word);
    }
    expect(shown).toContain('Approving needs the right to edit and to run the project.');
    expect(buttonNamed(markup, 'Approve').found).toBe(false);
    expect(buttonNamed(markup, 'Find stakeholders').found).toBe(false);
    expect(buttonNamed(markup, 'Save changes to the actors').found).toBe(false);
    expect(buttonNamed(markup, 'Reset all actors').found).toBe(false);
  });
});

describe('approval', () => {
  it('says that a list is approved and that changing it takes the approval away, and offers to make the actors', () => {
    const markup = html(withSet({ approvedAt: FIXTURE_TIME }));
    const shown = visibleText(markup);
    expect(shown).toContain('Approved ');
    expect(shown).toContain(
      'Changing the list takes the approval away until you approve it again.',
    );
    expect(shown).toContain('No actors have been made from it yet.');
    expect(buttonNamed(markup, 'Make the actors')).toEqual({ found: true, disabled: false });
    expect(buttonNamed(markup, 'Approve stakeholders').found).toBe(false);
  });

  it('does not offer to make actors that already exist', () => {
    const markup = html(withSet({ approvedAt: FIXTURE_TIME }, { actors: actorsView() }));
    expect(buttonNamed(markup, 'Make the actors').found).toBe(false);
    expect(visibleText(markup)).not.toContain('No actors have been made from it yet.');
  });

  it('keeps the actors a person changed when approving again, and says so before they approve', () => {
    const cast = actorSetFixture();
    const edited = {
      ...cast,
      actors: cast.actors.map((actor, index) => (index === 1 ? { ...actor, edited: true } : actor)),
    };
    const markup = html(withSet({}, { actors: actorsView({ actors: edited, stale: true }) }));
    const shown = visibleText(markup);
    expect(shown).toContain('Approve the stakeholders');
    expect(shown).toContain('You changed 1 of the actors');
    expect(shown).toContain('approving keeps those changes instead of making the actors again');
    expect(buttonNamed(markup, 'Approve stakeholders and create actors').found).toBe(false);
    expect(buttonNamed(markup, 'Approve stakeholders').found).toBe(true);
    expect(shown).toContain('Edited by you');
  });

  it('shows what is being done, one thing at a time, with the buttons switched off', () => {
    const cases = [
      ['finding', 'Finding stakeholders…'],
      ['saving', 'Saving…'],
      ['approving', 'Approving the list…'],
      ['making-actors', 'Making the actors…'],
    ] as const;
    for (const [working, words] of cases) {
      const markup = html(withSet({}, { working }));
      expect(visibleText(markup), working).toContain(words);
      expect(buttonNamed(markup, 'Approve stakeholders and create actors').disabled).toBe(true);
    }
  });

  it('says why the last change was refused, and lets it be dismissed', () => {
    const markup = html(
      withSet({}, { problem: 'The stakeholders were changed by someone else. Reloaded.' }),
    );
    const shown = visibleText(markup);
    expect(shown).toContain('That did not work');
    expect(shown).toContain('The stakeholders were changed by someone else. Reloaded.');
    expect(buttonNamed(markup, 'Dismiss').found).toBe(true);
    expect(markup).toContain('role="alert"');
  });
});

describe('the actors', () => {
  const approved = (rest: Partial<StakeholderState> = {}) =>
    withSet({ approvedAt: FIXTURE_TIME }, { actors: actorsView(), ...rest });

  it('says that they are synthetic and that a size is an assumption, before listing them', () => {
    const shown = text(approved());
    expect(shown).toContain('Actors (5)');
    expect(shown).toContain('These actors are synthetic.');
    expect(shown).toContain('are assumptions, not counts of real people');
    expect(shown.indexOf('These actors are synthetic.')).toBeLessThan(
      shown.indexOf('Starting stance'),
    );
  });

  it('shows every trait of every actor on a labelled slider with where it came from and why', () => {
    const markup = html(approved());
    const shown = visibleText(markup);
    expect(markup.match(/type="range"/gu)).toHaveLength(5 * 11);
    expect(markup).toContain('aria-label="Influence of Provider"');
    expect(markup).toContain('aria-label="Starting stance of Subscribers"');
    expect(markup).toMatch(/aria-valuetext="0\.50, assumption"/u);
    for (const trait of ['Starting stance', 'Impact on them', 'Influence', 'Readiness to adopt']) {
      expect(shown, trait).toContain(trait);
    }
    expect(shown).toContain('Fixture assumption.');
    expect(shown).toContain('Key actor');
    expect(shown).toContain('Cohort');
    expectNamedControls(markup);
  });

  it('asks for a size and a number of simulated members only of a cohort, as assumptions', () => {
    const markup = html(approved());
    expect(markup.match(/type="number"/gu)).toHaveLength(2 * 2);
    const shown = visibleText(markup);
    expect(shown).toContain('Stands for about (an assumption)');
    expect(shown).toContain('Simulated members');
  });

  it('labels each trait by who set it, in words, not only in colour', () => {
    const cast = actorSetFixture();
    const traits = (actor: Actor): Actor => ({
      ...actor,
      traits: {
        ...actor.traits,
        influence: { ...actor.traits.influence, origin: 'user', rationale: 'Set by the person.' },
        trust: { ...actor.traits.trust, origin: 'model', rationale: 'Cites [S1].' },
        authority: { ...actor.traits.authority, origin: 'evidence', rationale: 'Passage S2.' },
      },
    });
    const markup = html(
      approved({
        actors: actorsView({
          actors: {
            ...cast,
            actors: [traits(actorFixture('provider', 'decision-maker')), ...cast.actors.slice(1)],
          },
        }),
      }),
    );
    expect(markup).toMatch(/stk-origin stk-origin-user"[^>]*>you</u);
    expect(markup).toMatch(/stk-origin stk-origin-model"[^>]*>model</u);
    expect(markup).toMatch(/stk-origin stk-origin-evidence"[^>]*>evidence</u);
    expect(markup).toMatch(/stk-origin stk-origin-system-assumption"[^>]*>assumption</u);
    expect(visibleText(markup)).toContain('Cites [S1].');
  });

  it('can be saved and reset, and the save waits until something has changed', () => {
    const markup = html(approved());
    expect(buttonNamed(markup, 'Save changes to the actors')).toEqual({
      found: true,
      disabled: true,
    });
    expect(buttonNamed(markup, 'Discard unsaved changes').disabled).toBe(true);
    expect(buttonNamed(markup, 'Reset all actors').found).toBe(true);
  });

  it('switches every slider off for a person who may not edit, and still shows the values', () => {
    const markup = html(approved({ actors: actorsView({ may: READ_ONLY }) }));
    const sliders = [...markup.matchAll(/<input\b[^>]*type="range"[^>]*>/gu)].map((m) => m[0]);
    expect(sliders).toHaveLength(55);
    expect(sliders.every((slider) => /\sdisabled=""/u.test(slider))).toBe(true);
    expect(visibleText(markup)).toContain('0.50');
    expect(buttonNamed(markup, 'Save changes to the actors').found).toBe(false);
  });

  it('says when the actors are older than the stakeholders, and that the simulation uses them as they are', () => {
    const markup = html(approved({ actors: actorsView({ stale: true }) }));
    const shown = visibleText(markup);
    expect(shown).toContain('These actors are out of date');
    expect(shown).toContain('The simulation uses the actors as they are now');
    expect(markup).toContain('notice-warning');
    expect(text(approved())).not.toContain('out of date');
  });

  it('notes what generation could and could not do', () => {
    const cast = actorSetFixture();
    const shown = text(
      approved({
        actors: actorsView({
          actors: {
            ...cast,
            note: 'Every trait starts from the category prior; the model was not used.',
          },
        }),
      }),
    );
    expect(shown).toContain('Every trait starts from the category prior; the model was not used.');
  });

  it('shows nothing of the secrets a page like this must never hold', () => {
    expectNoSecretLikeText(text(approved()));
    expectNoSecretLikeText(text(withSet()));
    expectNoSecretLikeText(text(state()));
  });
});

describe('the form for a stakeholder', () => {
  const markup = renderToStaticMarkup(
    <StakeholderForm
      heading="Add a stakeholder"
      initial={EMPTY_DRAFT}
      submitLabel="Add stakeholder"
      busy={false}
      onSubmit={() => undefined}
      onCancel={() => undefined}
    />,
  );

  it('asks for what makes a stakeholder and says that a size is an assumption', () => {
    const shown = visibleText(markup);
    for (const field of [
      'Name',
      'Category',
      'How directly',
      'Priority',
      'How many it stands for (an assumption)',
    ]) {
      expect(shown, field).toContain(field);
    }
    expect(shown).toContain('Add stakeholder');
    expect(shown).toContain('Cancel');
  });

  it('names every control and says nothing is wrong before anything is sent', () => {
    expectNamedControls(markup);
    expect(markup).not.toContain('role="alert"');
    expect(markup).not.toContain('aria-invalid');
  });

  it('offers every category by its label', () => {
    for (const label of ['Decision maker', 'Bears cost', 'Competitor', 'Regulator', 'Other']) {
      expect(markup, label).toContain(`>${label}</option>`);
    }
  });
});

describe('the words on the page belong to no market or product', () => {
  it('names no product, platform or industry in what it says before, during and after discovery', () => {
    const everything = [
      text(state()),
      text(withSet()),
      text(withSet({ approvedAt: FIXTURE_TIME }, { actors: actorsView() })),
    ].join(' ');
    expect(everything).not.toMatch(/\b(?:AWS|Azure|Copilot|checkout|e-commerce)\b/iu);
  });
});
