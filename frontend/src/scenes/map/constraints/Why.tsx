import { FileText, Info } from 'lucide-react';
import {
  CONFIDENCE_BASIS_WORDS,
  EFFECT_CATALOGUE,
  sourceLabel,
  type Constraint,
} from '../../../../../shared/constraints';
import { Button, Popover, PopoverContent, PopoverTrigger } from '../../../design/ui';
import { consideredWords } from './model';
import { SOURCE_ICONS } from './sources';

const UNCERTAINTY_WORDS = {
  low: 'Low uncertainty',
  medium: 'Medium uncertainty',
  high: 'High uncertainty',
} as const;

/** The passages a constraint was found in, each quote word for word with where it was taken from. */
export function Quotes({ constraint }: { constraint: Constraint }) {
  if (constraint.evidenceRefs.length === 0) return null;
  return (
    <ul className="sw-cquotes">
      {constraint.evidenceRefs.map((ref, index) => (
        <li key={`${ref.passageId}-${index}`}>
          {ref.quote ? (
            <blockquote>“{ref.quote}”</blockquote>
          ) : (
            <p className="sw-caption">No excerpt was kept for this passage.</p>
          )}
          <p className="sw-cquotes__source">
            <FileText size={13} aria-hidden="true" />
            <span>{ref.documentName}</span>
            <span className="sw-mono">{ref.passageId}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Where a constraint came from and how far to trust it, one press away: the words it was read in, what is
 * and is not known of it, and what the simulation does with it. An inferred constraint says that no source
 * says it, so that it is never read as a fact.
 */
export function Why({ constraint }: { constraint: Constraint }) {
  const { confidenceBasis, uncertainty, source } = constraint;
  const Icon = SOURCE_ICONS[source];
  const effects = constraint.effects.map((effect) => EFFECT_CATALOGUE[effect.kind]);
  const shown =
    source === 'extracted' && constraint.evidenceRefs.length > 0
      ? `Evidence (${constraint.evidenceRefs.length})`
      : 'Where from';
  // The name begins with the words on the button, so that voice control can say what it sees, and goes on to say which one.
  const name = `${shown}: ${constraint.statement.length > 80 ? `${constraint.statement.slice(0, 79)}…` : constraint.statement}`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          icon={<Info size={14} aria-hidden="true" />}
          aria-label={name}
        >
          {shown}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        width="26rem"
        className="sw-cwhy"
        aria-label={`Where this came from: ${sourceLabel(constraint)}`}
      >
        <p className="sw-eyebrow">
          <Icon size={13} aria-hidden="true" /> {sourceLabel(constraint)}
        </p>
        <p>
          {CONFIDENCE_BASIS_WORDS[confidenceBasis.kind]}
          {confidenceBasis.note ? ` ${confidenceBasis.note}` : ''}
        </p>
        {source === 'inferred' && (
          <p className="sw-cwhy__warn">
            No source or person has said this holds. It is a suggestion until you confirm it.
          </p>
        )}
        <Quotes constraint={constraint} />
        {constraint.hardnessBasis && (
          <p className="sw-caption sw-cwhy__hardness">{constraint.hardnessBasis}</p>
        )}
        <p className="sw-caption">
          {UNCERTAINTY_WORDS[uncertainty.level]}
          {uncertainty.reason ? `: ${uncertainty.reason}` : ''}
        </p>
        {consideredWords(constraint) && <p className="sw-caption">{consideredWords(constraint)}</p>}
        {effects.length > 0 && (
          <div className="sw-cwhy__engine">
            <p className="sw-eyebrow">What the simulation does with it</p>
            {effects.map((info) => (
              <p key={info.label}>{info.engine}</p>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
