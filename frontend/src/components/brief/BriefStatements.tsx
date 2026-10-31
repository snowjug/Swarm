import {
  Activity,
  CircleHelp,
  FileText,
  Globe,
  History,
  Settings2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sigma,
  Sparkles,
  User,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  STATEMENT_ORIGIN_LABELS,
  type BriefRefs,
  type BriefStatement,
  type BriefVisuals,
  type StatementOrigin,
} from '../../../../shared/brief';
import {
  ORIGIN_MEANINGS,
  RELIANCE_LABELS,
  RELIANCE_MEANINGS,
  STABILITY_LABELS,
  hasRefs,
  signedNumber,
  type Reliance,
} from '../../lib/brief';

// A different glyph for each origin and each level, so that meaning never depends on colour.
const ORIGIN_ICONS: Record<StatementOrigin, LucideIcon> = {
  'supplied-evidence': FileText,
  'retrieved-public-evidence': Globe,
  'user-assumption': User,
  'system-assumption': Settings2,
  'inferred-stakeholder': Users,
  'actor-behavior': Activity,
  'simulation-aggregation': Sigma,
  'model-interpretation': Sparkles,
  'historical-comparison': History,
  'unresolved-uncertainty': CircleHelp,
};

const RELIANCE_ICONS: Record<Reliance, LucideIcon> = {
  high: ShieldCheck,
  moderate: Shield,
  low: ShieldAlert,
};

export function OriginBadge({ origin }: { origin: StatementOrigin }) {
  const Icon = ORIGIN_ICONS[origin];
  return (
    <span className={`brief-origin brief-origin-${origin}`} title={ORIGIN_MEANINGS[origin]}>
      <Icon size={12} aria-hidden="true" />
      {STATEMENT_ORIGIN_LABELS[origin]}
    </span>
  );
}

export function RelianceBadge({ reliance }: { reliance: Reliance }) {
  const Icon = RELIANCE_ICONS[reliance];
  return (
    <span
      className={`brief-reliance brief-reliance-${reliance}`}
      title={RELIANCE_MEANINGS[reliance]}
    >
      <Icon size={12} aria-hidden="true" />
      {RELIANCE_LABELS[reliance]}
    </span>
  );
}

/** What a statement rests on, opened from the statement: the passage, the finding, the assumption. */
export function RefsDetails({ refs, visuals }: { refs: BriefRefs; visuals: BriefVisuals | null }) {
  if (!hasRefs(refs)) return null;
  const lookups = visuals?.lookups ?? null;
  const count =
    refs.evidence.length +
    refs.findingIds.length +
    refs.sensitivityIds.length +
    refs.assumptions.length +
    refs.stakeholderIds.length +
    refs.documentIds.length +
    refs.variantIds.length +
    refs.critiqueIds.length;
  return (
    <details className="brief-refs">
      <summary>
        What this rests on <span className="brief-count">({count})</span>
      </summary>
      <ul>
        {refs.evidence.map((ref) => (
          <li key={`${ref.passageId}-${ref.role}`}>
            <span className="brief-ref-kind">
              {ref.role === 'supports' ? 'Passage that supports' : 'Passage that contradicts'}
            </span>{' '}
            <code>{ref.passageId}</code> in {ref.documentName}
            {ref.quote ? (
              <>
                : <q>{ref.quote}</q>
              </>
            ) : null}
          </li>
        ))}
        {refs.findingIds.map((id) => {
          const finding = lookups?.findings.find((entry) => entry.id === id);
          return (
            <li key={`finding-${id}`}>
              <span className="brief-ref-kind">Finding</span> <code>{id}</code>
              {finding ? (
                <>
                  : {finding.statement} Held in {finding.holdsIn} of {finding.of} seeded runs
                  (interval {finding.interval.lo.toFixed(2)} to {finding.interval.hi.toFixed(2)};{' '}
                  {STABILITY_LABELS[finding.classification]}).
                </>
              ) : null}
            </li>
          );
        })}
        {refs.sensitivityIds.map((id) => {
          const row = visuals?.sensitivity.find((entry) => entry.id === id);
          return (
            <li key={`sensitivity-${id}`}>
              <span className="brief-ref-kind">Sensitivity</span> <code>{id}</code>
              {row ? (
                <>
                  : {row.label}; shift {signedNumber(row.shift)} (standard error{' '}
                  {row.standardError.toFixed(2)}).
                </>
              ) : null}
            </li>
          );
        })}
        {refs.assumptions.map((assumption) => (
          <li key={`assumption-${assumption}`}>
            <span className="brief-ref-kind">Assumption</span> {assumption}
          </li>
        ))}
        {refs.stakeholderIds.map((id) => (
          <li key={`stakeholder-${id}`}>
            <span className="brief-ref-kind">Stakeholder</span>{' '}
            {lookups?.stakeholders.find((entry) => entry.id === id)?.name ?? id}
          </li>
        ))}
        {refs.documentIds.map((id) => {
          const document = lookups?.documents.find((entry) => entry.id === id);
          return (
            <li key={`document-${id}`}>
              <span className="brief-ref-kind">Source document</span> {document?.name ?? id}
              {document ? <> — {document.provenance}</> : null}
            </li>
          );
        })}
        {refs.variantIds.map((id) => (
          <li key={`variant-${id}`}>
            <span className="brief-ref-kind">Seeded runs of</span>{' '}
            {lookups?.variants.find((entry) => entry.id === id)?.label ?? id}
          </li>
        ))}
        {refs.critiqueIds.map((id) => (
          <li key={`critique-${id}`}>
            <span className="brief-ref-kind">Critique</span> <code>{id}</code>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function BriefStatementItem({
  statement,
  visuals,
}: {
  statement: BriefStatement;
  visuals: BriefVisuals | null;
}) {
  return (
    <li className="brief-statement" id={`statement-${statement.id}`}>
      <p>
        <span className="brief-badges">
          <OriginBadge origin={statement.origin} />
          {statement.reliance ? <RelianceBadge reliance={statement.reliance} /> : null}
        </span>{' '}
        <span className="brief-text">{statement.text}</span>
      </p>
      <RefsDetails refs={statement.refs} visuals={visuals} />
    </li>
  );
}

export function BriefStatementList({
  statements,
  visuals,
}: {
  statements: readonly BriefStatement[];
  visuals: BriefVisuals | null;
}) {
  if (statements.length === 0) return null;
  return (
    <ul className="brief-statements">
      {statements.map((statement) => (
        <BriefStatementItem key={statement.id} statement={statement} visuals={visuals} />
      ))}
    </ul>
  );
}
