import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { BriefStatement } from '../../../../../shared/brief';
import { leadIn, riskKind } from '../model/brief-model';
import { plural, sentence } from '../model/format';
import { useDoc } from './context';
import { NoteStack } from './Notes';
import { OriginMark } from './Provenance';
import { Prose } from './Prose';
import './statements.css';

export type StatementStyle = 'plain' | 'labelled' | 'risks';

function StatementText({ statement, style }: { statement: BriefStatement; style: StatementStyle }) {
  const lead = style === 'plain' ? null : leadIn(statement.text);
  const kind = style === 'risks' ? riskKind(statement.text) : null;
  if (style === 'risks' && kind && lead) {
    return (
      <>
        <span className="sw-decide-tag" data-tone={kind}>
          {kind === 'risk' ? 'Risk' : 'Opportunity'}
          {lead.label.includes('outside') ? ' \u00b7 outside' : ''}
        </span>{' '}
        <Prose text={lead.rest} />
      </>
    );
  }
  if (lead && style === 'labelled') {
    return (
      <>
        <strong className="sw-decide-stmt__label">{lead.label}</strong>{' '}
        <Prose text={sentence(lead.rest)} />
      </>
    );
  }
  return <Prose text={statement.text} />;
}

/** One statement of the brief with its origin one press away and any criticisms of it beside it. */
export function StatementItem({
  statement,
  style = 'plain',
}: {
  statement: BriefStatement;
  style?: StatementStyle;
}) {
  const { anchors } = useDoc();
  const notes = anchors.byStatement.get(statement.id) ?? [];
  return (
    <li className="sw-decide-stmt" id={`statement-${statement.id}`}>
      <div className="sw-decide-stmt__main">
        <p className="sw-decide-stmt__text">
          <StatementText statement={statement} style={style} />
          <OriginMark statement={statement} />
        </p>
        <NoteStack critiques={notes} />
      </div>
    </li>
  );
}

/**
 * The statements of a chapter: the first few, and the rest one press away. All of them stay in the page
 * (the rest are only folded), so that find-in-page reaches them and the printed page holds them.
 */
export function StatementList({
  statements,
  show,
  style = 'plain',
  label,
}: {
  statements: readonly BriefStatement[];
  show: number;
  style?: StatementStyle;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (statements.length === 0) return null;
  const first = statements.slice(0, Math.max(show, 0));
  const rest = statements.slice(first.length);
  return (
    <div className="sw-decide-stmts">
      {first.length > 0 && (
        <ul className="sw-decide-stmts__list" role="list" aria-label={label}>
          {first.map((statement) => (
            <StatementItem key={statement.id} statement={statement} style={style} />
          ))}
        </ul>
      )}
      {rest.length > 0 && (
        <>
          <div className="sw-decide-fold" id={id} data-open={open} inert={!open}>
            <div className="sw-decide-fold__inner">
              <ul
                className="sw-decide-stmts__list"
                role="list"
                aria-label={label ? `${label}, the rest` : undefined}
              >
                {rest.map((statement) => (
                  <StatementItem key={statement.id} statement={statement} style={style} />
                ))}
              </ul>
            </div>
          </div>
          <button
            type="button"
            className="sw-decide-more"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen((old) => !old)}
          >
            <span>{open ? 'Show fewer' : `Show ${plural(rest.length, 'more statement')}`}</span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  );
}
