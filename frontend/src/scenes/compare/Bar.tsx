import { m } from 'motion/react';
import { ArrowRight, GitFork, Info, ListTree, RotateCcw } from 'lucide-react';
import type { AnalysisSummary } from '../../../../shared/analysis-plan';
import { SPRING } from '../../design/motion';
import {
  Button,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from '../../design/ui';
import { SECTIONS } from './copy';
import { summaryLine } from './format';
import { PairPill, type PairControl } from './PairMenu';
import './bar.css';

/**
 * The few things a person does from anywhere on the page, kept in one quiet floating bar: which two scenarios
 * are set against each other, the way to other parts of the page and to other saved comparisons, the method,
 * and the two steps out: run again, or decide. On a phone the less used ones move into the menu.
 */
export function Bar({
  control,
  summaries,
  currentId,
  compact,
  onSelect,
  onJump,
  onMethod,
  onRun,
  onDecide,
  onRuns,
  pending,
  away,
}: {
  control: PairControl;
  summaries: readonly AnalysisSummary[];
  currentId: string;
  compact: boolean;
  onSelect: (id: string) => void;
  onJump: (id: string) => void;
  onMethod: () => void;
  onRun: () => void;
  onDecide: () => void;
  /** Two recorded runs, set against each other; null when the project has no two. */
  onRuns: (() => void) | null;
  /** A saved comparison has been asked for and is being read. */
  pending: boolean;
  /** The end of the page is in view and says the same things: the bar steps aside. */
  away: boolean;
}) {
  const saved = summaries.filter((summary) => summary.status === 'completed');
  return (
    <div className="sw-cmp-bar-wrap" data-away={away || undefined} inert={away}>
      <m.div
        className="sw-cmp-bar sw-glass sw-glass--raised"
        role="toolbar"
        aria-label="Compare controls"
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SPRING.smooth, delay: 0.4 }}
        aria-busy={pending || undefined}
      >
        <PairPill control={control} className="sw-cmp-bar__pair" compact={compact} />
        <span className="sw-cmp-bar__sep" aria-hidden="true" />
        {!compact && (
          <IconButton label="Method" size="sm" onClick={onMethod}>
            <Info size={17} aria-hidden="true" />
          </IconButton>
        )}
        <Menu>
          <MenuTrigger asChild>
            <IconButton label="Parts of the page, saved comparisons" size="sm">
              <ListTree size={17} aria-hidden="true" />
            </IconButton>
          </MenuTrigger>
          <MenuContent align="end" side="top" className="sw-cmp-menu">
            <MenuLabel>Jump to</MenuLabel>
            {SECTIONS.map((section) => (
              <MenuItem key={section.id} onSelect={() => onJump(section.id)}>
                {section.nav}
              </MenuItem>
            ))}
            {saved.length > 1 && (
              <>
                <MenuSeparator />
                <MenuLabel>Saved comparisons</MenuLabel>
                <MenuRadioGroup value={currentId} onValueChange={onSelect}>
                  {saved.map((summary) => (
                    <MenuRadioItem key={summary.id} value={summary.id}>
                      {summaryLine(summary)}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </>
            )}
            {onRuns && (
              <>
                <MenuSeparator />
                <MenuItem icon={<GitFork size={16} aria-hidden="true" />} onSelect={onRuns}>
                  Compare two recorded runs
                </MenuItem>
              </>
            )}
            {compact && (
              <>
                <MenuSeparator />
                <MenuItem icon={<Info size={16} aria-hidden="true" />} onSelect={onMethod}>
                  Method
                </MenuItem>
                <MenuItem icon={<RotateCcw size={16} aria-hidden="true" />} onSelect={onRun}>
                  Run again
                </MenuItem>
              </>
            )}
          </MenuContent>
        </Menu>
        {!compact && (
          <Button
            variant="ghost"
            size="sm"
            icon={<RotateCcw size={15} aria-hidden="true" />}
            onClick={onRun}
          >
            Run again
          </Button>
        )}
        <Button
          variant="primary"
          size="sm"
          iconEnd={<ArrowRight size={16} aria-hidden="true" />}
          onClick={onDecide}
        >
          Decide
        </Button>
      </m.div>
    </div>
  );
}
