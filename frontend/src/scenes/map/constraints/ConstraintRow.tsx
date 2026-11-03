import {
  Check,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Scale,
  TriangleAlert,
  Trash2,
} from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import {
  CONSTRAINT_CATEGORY_LABELS,
  EFFECT_CATALOGUE,
  VALIDATION_LABELS,
  effectPhrase,
  sourceLabel,
  type Constraint,
} from '../../../../../shared/constraints';
import {
  Button,
  Chip,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Tooltip,
} from '../../../design/ui';
import {
  APPLIED_WORDS,
  CHOICE_HINTS,
  CHOICE_WORDS,
  appliedStateOf,
  appliedTone,
  choicesOf,
  consideredWords,
  namesOf,
  validationTone,
  windowWords,
  type ReviewChoice,
} from './model';
import { SOURCE_ICONS } from './sources';
import { Why } from './Why';

export interface Names {
  actors: ReadonlyMap<string, string>;
  alternatives: ReadonlyMap<string, string>;
  /** Every constraint of the set by id, so that a conflict can name the other. */
  constraints: ReadonlyMap<string, Constraint>;
}

const ICONS: Partial<Record<ReviewChoice, ReactNode>> = {
  confirm: <Check size={15} aria-hidden="true" />,
  accept: <Check size={15} aria-hidden="true" />,
  edit: <Pencil size={15} aria-hidden="true" />,
  remove: <Trash2 size={15} aria-hidden="true" />,
  restore: <RotateCcw size={15} aria-hidden="true" />,
};

/** What a constraint says about who and what it covers, in a line, with what it does not cover left unsaid. */
function Scope({ constraint, names }: { constraint: Constraint; names: Names }) {
  const actors = namesOf(constraint.affectedActorIds, names.actors);
  const alternatives = namesOf(constraint.affectedAlternativeIds, names.alternatives);
  const window = windowWords(constraint.window);
  const parts = [
    actors.length > 0 ? `Affects ${actors.join(', ')}` : '',
    alternatives.length > 0 ? `Applies to ${alternatives.join(', ')}` : '',
    window,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return <p className="sw-con__meta">{parts.join(' · ')}</p>;
}

function ConflictLine({ constraint, names }: { constraint: Constraint; names: Names }) {
  const others = constraint.conflict.flatMap((token) => {
    const other = names.constraints.get(token.replace('conflicts-with:', ''));
    return other ? [other.statement] : [];
  });
  if (others.length === 0) return null;
  return (
    <p className="sw-con__conflict">
      <TriangleAlert size={14} aria-hidden="true" />
      <span>
        These cannot both hold: “{others[0]}”
        {others.length > 1 ? ` and ${others.length - 1} more` : ''}. Set one aside or change its
        words.
      </span>
    </p>
  );
}

export interface ConstraintRowProps {
  constraint: Constraint;
  names: Names;
  /** The person may change constraints. */
  canEdit: boolean;
  busy: boolean;
  onChoose: (choice: ReviewChoice, constraint: Constraint) => void;
}

/**
 * One constraint, as a line of the list and not a card: what it says in its own words, where it came
 * from, whether anyone has checked it, and whether the simulation runs under it. Nothing about where it
 * came from is shown as a fact it is not, and what the simulation cannot apply is said to be read only.
 */
export function ConstraintRow({ constraint, names, canEdit, busy, onChoose }: ConstraintRowProps) {
  const state = appliedStateOf(constraint);
  const Source = SOURCE_ICONS[constraint.source];
  const { primary, more } = choicesOf(constraint);
  const considered = consideredWords(constraint);
  const category = CONSTRAINT_CATEGORY_LABELS[constraint.category];
  return (
    <li
      className="sw-con"
      data-hardness={constraint.hardness}
      data-review={constraint.review}
      data-state={state}
      aria-label={`${category}: ${constraint.statement}`}
    >
      <div className="sw-con__head">
        <span className="sw-eyebrow">{category}</span>
        <div className="sw-con__chips">
          <Chip size="sm" tone={constraint.hardness === 'hard' ? 'caution' : 'neutral'}>
            {constraint.hardness === 'hard' ? 'Hard' : 'Soft'}
          </Chip>
          <Chip size="sm" icon={<Source size={12} aria-hidden="true" />}>
            {sourceLabel(constraint)}
          </Chip>
          <Chip size="sm" tone={validationTone(constraint.validation)} dot>
            {VALIDATION_LABELS[constraint.validation]}
          </Chip>
          {constraint.review === 'proposed' && (
            <Chip size="sm" tone="accent">
              Needs your look
            </Chip>
          )}
          <Chip size="sm" tone={appliedTone(state)}>
            {APPLIED_WORDS[state]}
          </Chip>
          {constraint.conflict.length > 0 && (
            <Chip size="sm" tone="caution" icon={<Scale size={12} aria-hidden="true" />}>
              Conflicts
            </Chip>
          )}
        </div>
      </div>
      <p className="sw-con__statement">{constraint.statement}</p>
      <Scope constraint={constraint} names={names} />
      <ConflictLine constraint={constraint} names={names} />
      {constraint.effects.length > 0 && (
        <ul className="sw-con__effects" aria-label="What the simulation does with it">
          {constraint.effects.map((effect) => (
            <li key={effect.kind} title={EFFECT_CATALOGUE[effect.kind].engine}>
              {effectPhrase(effect)}
            </li>
          ))}
        </ul>
      )}
      {considered && <p className="sw-con__meta">{considered}</p>}
      {constraint.note && <p className="sw-con__meta">Your note: {constraint.note}</p>}
      <div className="sw-con__actions">
        <Why constraint={constraint} />
        {canEdit && (
          <>
            {primary.map((choice) => (
              <Tooltip key={choice} label={CHOICE_HINTS[choice]}>
                <Button
                  size="sm"
                  variant={choice === 'confirm' || choice === 'restore' ? 'glass' : 'ghost'}
                  icon={ICONS[choice]}
                  disabled={busy}
                  aria-label={`${CHOICE_WORDS[choice]}: ${constraint.statement}`}
                  onClick={() => onChoose(choice, constraint)}
                >
                  {CHOICE_WORDS[choice]}
                </Button>
              </Tooltip>
            ))}
            {more.length > 0 && (
              <Menu>
                <MenuTrigger asChild>
                  <IconButton label={`More for: ${constraint.statement}`} size="sm" disabled={busy}>
                    <MoreHorizontal size={16} aria-hidden="true" />
                  </IconButton>
                </MenuTrigger>
                <MenuContent align="end">
                  {more.map((choice) => (
                    <Fragment key={choice}>
                      {choice === 'exclude' && <MenuSeparator />}
                      <MenuItem
                        icon={ICONS[choice]}
                        tone={choice === 'remove' ? 'danger' : undefined}
                        onSelect={() => onChoose(choice, constraint)}
                      >
                        {CHOICE_WORDS[choice]}
                      </MenuItem>
                    </Fragment>
                  ))}
                </MenuContent>
              </Menu>
            )}
          </>
        )}
      </div>
    </li>
  );
}
