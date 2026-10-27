import { BookOpen, GitBranch, LayoutPanelLeft, PanelRight } from 'lucide-react';

export type ConsoleView = 'graph' | 'split' | 'workbench';
export const CONSOLE_NARROW_QUERY = '(max-width: 900px)';

export function ConsoleViewControls({
  narrow,
  leftLabel,
  view,
  onChange,
}: {
  narrow: boolean;
  leftLabel: 'Graph' | 'Report';
  view: ConsoleView;
  onChange: (view: ConsoleView) => void;
}) {
  const selected = narrow && view === 'split' ? 'workbench' : view;
  return (
    <div
      className={`segmented ${narrow ? 'pane-toggle' : 'view-toggle'}`}
      role="group"
      aria-label={narrow ? 'Console pane' : 'Console view'}
    >
      <button type="button" aria-pressed={selected === 'graph'} onClick={() => onChange('graph')}>
        {leftLabel === 'Graph' ? (
          <GitBranch size={14} aria-hidden="true" />
        ) : (
          <BookOpen size={14} aria-hidden="true" />
        )}{' '}
        {leftLabel}
      </button>
      {!narrow && (
        <button type="button" aria-pressed={selected === 'split'} onClick={() => onChange('split')}>
          <LayoutPanelLeft size={14} aria-hidden="true" /> Split
        </button>
      )}
      <button
        type="button"
        aria-pressed={selected === 'workbench'}
        onClick={() => onChange('workbench')}
      >
        <PanelRight size={14} aria-hidden="true" /> Workbench
      </button>
    </div>
  );
}
