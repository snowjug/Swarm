import {
  ALIGNMENT_WORDS,
  ALTERNATIVE_VERDICT_WORDS,
  EPISTEMIC_LABEL_INFO,
  EXPLORE_NOT_PREDICT,
  LENS_STANDING_WORDS,
  NO_ACTION_NOTE,
  POSITION_WORDS,
  RECOMMENDATION_PART_WORDS,
  REVERSIBILITY_WORDS,
  SCOPE_DOMAIN_WORDS,
  SYNTHETIC_ACTORS_NOTE,
  recommendationCompleteness,
  type DecisionCanvas,
  type Labelled,
  type Part,
} from '../../../shared/decision.js';
import { signed } from '../brief/text.js';

/**
 * The canvas as the blocks an export is written from, so that Markdown and the printable page say the
 * same things and the decision picture comes before anything else in them. Every piece of text is
 * escaped by the exporter that prints it: a name, a quotation or a finding is data, whatever it contains.
 */

export type CanvasBlock =
  | { kind: 'heading'; level: 2 | 3; text: string; anchor?: string }
  | { kind: 'paragraph'; text: string; tone?: 'notice' | 'note' | 'alert'; title?: string }
  | {
      kind: 'statement';
      id: string;
      origin: string;
      reliance: string | null;
      text: string;
      rests: string[];
    }
  | { kind: 'table'; caption: string; headers: string[]; rows: string[][] };

const said = (line: Labelled, id = line.basis ?? ''): CanvasBlock => ({
  kind: 'statement',
  id,
  origin: EPISTEMIC_LABEL_INFO[line.label].name,
  reliance: null,
  text: line.text,
  rests: [],
});

const partBlocks = (title: string, part: Part): CanvasBlock[] =>
  part.items.length > 0
    ? part.items.map((line) => said(line, title))
    : [
        {
          kind: 'paragraph',
          text: `${title}: missing. ${part.missing ?? ''}`.trim(),
          tone: 'note',
        },
      ];

export function canvasBlocks(canvas: DecisionCanvas): CanvasBlock[] {
  const { status, answer, question } = canvas;
  const card = answer.recommendation;
  const done = recommendationCompleteness(card);
  const blocks: CanvasBlock[] = [
    { kind: 'heading', level: 2, text: 'Decision view', anchor: 'decision-view' },
    { kind: 'paragraph', text: `${EXPLORE_NOT_PREDICT} ${SYNTHETIC_ACTORS_NOTE}`, tone: 'notice' },
  ];
  if (canvas.scope.notice) {
    blocks.push({
      kind: 'paragraph',
      title: 'Scope.',
      text: `${canvas.scope.notice} What the question touches: ${canvas.scope.domains.map((domain) => SCOPE_DOMAIN_WORDS[domain].label.toLowerCase()).join(', ')}.`,
      tone: 'notice',
    });
  }
  if (canvas.freshness.stale) {
    blocks.push({
      kind: 'paragraph',
      title: 'This picture may be out of date.',
      text: `The comparison it rests on was run before ${canvas.freshness.changedSince.join(', ') || 'something it is made from'} changed.`,
      tone: 'alert',
    });
  }

  blocks.push(
    { kind: 'heading', level: 3, text: '1. Question' },
    { kind: 'paragraph', text: question.asked },
    said(question.decision, 'Decision as framed'),
    said(question.baseline, 'Baseline'),
  );

  blocks.push(
    { kind: 'heading', level: 3, text: '2. Current best answer' },
    {
      kind: 'paragraph',
      title: `${status.label}.`,
      text: `${status.headline} ${status.meaning}`,
      tone: 'alert',
    },
    ...status.why.map((line): CanvasBlock => ({ kind: 'paragraph', text: line, tone: 'note' })),
    ...status.conditions.map((line): CanvasBlock => ({
      kind: 'paragraph',
      title: 'Condition.',
      text: line,
      tone: 'note',
    })),
    {
      kind: 'table',
      caption: 'The options on each lens',
      headers: ['Option', 'Verdict', ...canvas.lenses.map((lens) => lens.name)],
      rows: canvas.alternatives.map((option) => [
        option.label,
        ALTERNATIVE_VERDICT_WORDS[option.verdict],
        ...canvas.lenses.map(
          (lens) => LENS_STANDING_WORDS[option.standing[lens.id] ?? 'not-assessed'],
        ),
      ]),
    },
    { kind: 'paragraph', text: canvas.lensAgreement.statement, tone: 'note' },
  );

  blocks.push({ kind: 'heading', level: 3, text: '3. Most plausible futures' });
  if (canvas.futures.items.length === 0) {
    blocks.push({ kind: 'paragraph', text: canvas.futures.note, tone: 'note' });
  } else {
    blocks.push(...canvas.futures.items.map((future) => said(future.statement, future.label)));
    blocks.push({ kind: 'paragraph', text: canvas.futures.note, tone: 'note' });
  }

  blocks.push({ kind: 'heading', level: 3, text: '4. What drives them' });
  blocks.push(
    ...(canvas.drivers.length > 0
      ? canvas.drivers.map((driver) => said(driver.statement, driver.kind))
      : [
          {
            kind: 'paragraph',
            text: 'No driver stood out in the simulation.',
            tone: 'note',
          } as CanvasBlock,
        ]),
  );

  const rows = [...canvas.constraints.hard, ...canvas.constraints.soft];
  blocks.push(
    { kind: 'heading', level: 3, text: '5. Material constraints' },
    { kind: 'paragraph', text: canvas.constraints.gateSummary, tone: 'note' },
  );
  if (canvas.constraints.provisionalLabel) {
    blocks.push({
      kind: 'paragraph',
      title: 'Provisional.',
      text: canvas.constraints.provisionalLabel,
      tone: 'alert',
    });
  }
  blocks.push(
    rows.length > 0
      ? {
          kind: 'table',
          caption: 'Constraints behind the answer',
          headers: [
            'Constraint',
            'Hardness',
            'Source',
            'Kind of statement',
            'Validation',
            'In the simulation',
          ],
          rows: rows.map((row) => [
            row.statement,
            row.hardness === 'hard' ? 'Hard' : 'Soft',
            row.source,
            EPISTEMIC_LABEL_INFO[row.label].name,
            row.validation,
            row.inComparison === 'applied'
              ? 'Applied'
              : row.inComparison === 'read-only'
                ? 'Read only'
                : row.enforcement === 'read-only'
                  ? 'Read only'
                  : 'Not recorded',
          ]),
        }
      : { kind: 'paragraph', text: canvas.constraints.note, tone: 'note' },
  );

  blocks.push({ kind: 'heading', level: 3, text: '6. Who moves' });
  blocks.push(
    canvas.actors.items.length > 0
      ? {
          kind: 'table',
          caption: `Simulated roles under ${canvas.actors.focusLabel ?? 'the option shown'}${canvas.actors.baselineLabel ? `, against ${canvas.actors.baselineLabel}` : ''}`,
          headers: [
            'Role',
            'Position in the decision',
            'Where it ends up',
            'Change in simulated share resisting',
            'Influence',
            'Uncertainty',
          ],
          rows: canvas.actors.items
            .slice(0, 8)
            .map((actor) => [
              actor.name,
              POSITION_WORDS[actor.position],
              ALIGNMENT_WORDS[actor.alignment],
              actor.adverseChange === null ? 'Not compared' : signed(actor.adverseChange),
              actor.influence,
              actor.uncertainty,
            ]),
        }
      : { kind: 'paragraph', text: 'No role was simulated.', tone: 'note' },
  );
  blocks.push({ kind: 'paragraph', text: canvas.actors.note, tone: 'note' });

  blocks.push({ kind: 'heading', level: 3, text: '7. What could change the result' });
  const views = canvas.changes.counterfactuals.views;
  blocks.push(
    views.length > 0
      ? {
          kind: 'table',
          caption: 'Counterfactual views of the proposed change',
          headers: ['View', 'Moved the simulated share by', 'Could change the answer'],
          rows: views.map((view) => [
            view.label,
            view.deltaVsBase === null ? 'Not run' : signed(view.deltaVsBase),
            view.couldChangeAnswer === null ? 'Not told' : view.couldChangeAnswer ? 'Yes' : 'No',
          ]),
        }
      : { kind: 'paragraph', text: canvas.changes.counterfactuals.note, tone: 'note' },
  );
  blocks.push(
    ...canvas.changes.assumptions
      .slice(0, 5)
      .map((row) => said(row.statement, 'Sensitive assumption')),
  );
  blocks.push(
    { kind: 'paragraph', text: canvas.noRegret.note, tone: 'note' },
    ...canvas.noRegret.moves.map((move) => said(move, 'No-regret move')),
  );

  blocks.push(
    { kind: 'heading', level: 3, text: '8. Recommended next move' },
    said(card.what, 'Recommendation'),
    ...(canvas.scope.exploration
      ? [
          ...canvas.scope.exploration.canTell.map((line) =>
            said(line, 'What the exploration can tell them'),
          ),
          ...canvas.scope.exploration.cannotTell.map((line) =>
            said(line, 'What it cannot tell them'),
          ),
        ]
      : []),
    {
      kind: 'paragraph',
      text: `${done.stated} of ${done.total} parts stated.${done.missing.length > 0 ? ` Missing: ${done.missing.join(', ')}.` : ''}`,
      tone: 'note',
    },
    ...partBlocks(RECOMMENDATION_PART_WORDS.forWhom, card.forWhom),
    ...partBlocks(RECOMMENDATION_PART_WORDS.assumptions, card.assumptions),
    ...partBlocks(RECOMMENDATION_PART_WORDS.constraints, card.constraints),
    ...partBlocks(RECOMMENDATION_PART_WORDS.supportingEvidence, card.supportingEvidence),
    ...partBlocks(RECOMMENDATION_PART_WORDS.weakeningEvidence, card.weakeningEvidence),
    ...partBlocks(RECOMMENDATION_PART_WORDS.invalidatedBy, card.invalidatedBy),
    ...partBlocks(RECOMMENDATION_PART_WORDS.testNext, card.testNext),
    said(
      card.reversibility.statement,
      `${RECOMMENDATION_PART_WORDS.reversibility}: ${REVERSIBILITY_WORDS[card.reversibility.value]}`,
    ),
    ...partBlocks(RECOMMENDATION_PART_WORDS.approval, card.approval),
    { kind: 'paragraph', text: NO_ACTION_NOTE, tone: 'note' },
  );

  blocks.push({ kind: 'heading', level: 3, text: '9. What to validate before acting' });
  blocks.push(
    ...(canvas.validation.items.length > 0
      ? canvas.validation.items.map((item): CanvasBlock => ({
          kind: 'statement',
          id: `${item.priority} priority · ${item.kind}`,
          origin: EPISTEMIC_LABEL_INFO[item.label].name,
          reliance: null,
          text: `${item.what} Why: ${item.why} How: ${item.how}`,
          rests: [],
        }))
      : [{ kind: 'paragraph', text: 'No check was derived.', tone: 'note' } as CanvasBlock]),
    ...canvas.validation.stopConditions.map((stop): CanvasBlock => ({
      kind: 'statement',
      id: 'Stop and rethink',
      origin: EPISTEMIC_LABEL_INFO[stop.label].name,
      reliance: null,
      text: `If ${stop.when} Then: ${stop.then}`,
      rests: [],
    })),
  );

  blocks.push(
    { kind: 'heading', level: 3, text: 'What this rests on' },
    ...canvas.evidence.statements.map((line) => said(line, 'Evidence')),
    ...canvas.uncertainty.reasons.map((line) => said(line, 'Limit')),
    { kind: 'paragraph', text: canvas.uncertainty.note, tone: 'note' },
    {
      kind: 'paragraph',
      text: `Human approval: ${canvas.approvals.map((point) => `${point.stage === 'before-simulation' ? 'Before the simulation' : 'Before acting'}: ${point.text} (${point.state === 'done' ? 'recorded' : 'open'})`).join(' ')}`,
      tone: 'note',
    },
    {
      kind: 'paragraph',
      text: canvas.scope.notice
        ? `${canvas.scope.notice} Cues found: ${canvas.scope.basis.join('; ')}.`
        : 'Nothing in the question or its framing points to a matter of employment, credit, legal, medical or safety. Swarm still does not make the decision.',
      tone: 'note',
    },
    { kind: 'paragraph', text: 'The full decision brief follows.', tone: 'note' },
  );
  return blocks;
}
