import { STATEMENT_TYPE_LABELS, type StatementType } from '../../../../shared/evidence';
import { cx } from '../../design/cx';
import {
  FAMILY_HELP,
  FAMILY_ICON,
  FAMILY_LABEL,
  repeatsFamily,
  type StatementFamily,
} from './families';

/** The kind of a statement, as a glyph and a word in the kind's own tint. */
export function Kind({
  family,
  type,
  className,
}: {
  family: StatementFamily;
  /** The statement's own type: said in full beside the kind, unless it only repeats it. */
  type?: StatementType;
  className?: string;
}) {
  const Icon = FAMILY_ICON[family];
  const said = type ? STATEMENT_TYPE_LABELS[type] : null;
  return (
    <span
      className={cx('sw-ground-kind', className)}
      data-family={family}
      title={FAMILY_HELP[family]}
    >
      <Icon size={14} aria-hidden="true" />
      <span className="sw-ground-kind__word">{FAMILY_LABEL[family]}</span>
      {said && type && !repeatsFamily(type) && <span className="sw-ground-kind__type">{said}</span>}
      {said && type && repeatsFamily(type) && <span className="sr-only">: {said}</span>}
    </span>
  );
}
