import { GitCompareArrows, RotateCcw } from 'lucide-react';
import { SECTION_ORIGIN_LABELS, type StudioSectionView } from '../../../../shared/studio';
import { cx } from '../../design/cx';
import { Button, Chip } from '../../design/ui';
import { dateTime } from '../../lib/format';
import { actorLabel } from '../../lib/studio';
import { ORIGIN_ICONS } from './glyphs';
import './History.css';

/**
 * Every version the section has had, newest first, along a line. A version is never rewritten or removed:
 * bringing an earlier one back is a new version, and any of them can be read against the text as it is now.
 */
export function History({
  section,
  canRestore,
  pending,
  comparing,
  onCompare,
  onRestore,
}: {
  section: StudioSectionView;
  canRestore: boolean;
  pending: string | null;
  comparing: number | null;
  onCompare: (version: number | null) => void;
  onRestore: (version: number) => void;
}) {
  const newestFirst = [...section.versions].reverse();
  return (
    <ol className="sw-versions" role="list">
      {newestFirst.map((entry) => {
        const current = entry.version === section.version;
        const Icon = ORIGIN_ICONS[entry.origin];
        const open = comparing === entry.version;
        return (
          <li
            key={entry.version}
            className={cx('sw-version', current && 'is-current', open && 'is-comparing')}
          >
            <span className="sw-version__dot" aria-hidden="true" />
            <div className="sw-version__top">
              <p className="sw-version__name">
                <span className="num">Version {entry.version}</span>
                {current && <span className="sw-version__now">current</span>}
              </p>
              <Chip
                size="sm"
                tone={
                  entry.origin === 'generated'
                    ? 'neutral'
                    : entry.origin === 'human'
                      ? 'accent'
                      : 'caution'
                }
                icon={<Icon aria-hidden="true" />}
              >
                {SECTION_ORIGIN_LABELS[entry.origin]}
              </Chip>
            </div>
            <p className="sw-version__meta">
              {actorLabel(entry.actor)} · {dateTime(entry.at)}
              {entry.restoredFrom ? ` · restored from version ${entry.restoredFrom}` : ''}
            </p>
            {entry.reason && <p className="sw-version__why">“{entry.reason}”</p>}
            {!current && (
              <div className="sw-version__actions">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<GitCompareArrows size={15} aria-hidden="true" />}
                  aria-pressed={open}
                  onClick={() => onCompare(open ? null : entry.version)}
                >
                  {open ? 'Stop comparing' : 'Compare'}
                </Button>
                {canRestore && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<RotateCcw size={15} aria-hidden="true" />}
                    busy={pending === `restore:${section.id}:${entry.version}`}
                    busyLabel="Restoring"
                    disabled={pending !== null}
                    onClick={() => onRestore(entry.version)}
                  >
                    Restore
                  </Button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
