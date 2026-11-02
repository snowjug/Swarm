import type { StudioSectionView, StudioView } from '../../../../shared/studio';
import { TabPanel, Tabs, type TabItem } from '../../design/ui';
import type { StudioActions } from './actions';
import { History } from './History';
import { toolsOf, type SectionAccess, type ToolId } from './model';
import { Notes } from './Notes';
import { Rewrite } from './Rewrite';
import { Statements } from './Statements';
import './Tools.css';

/** A count is shown on a tab only when there is something to count. */
const counted = (count: number): { count?: number } => (count > 0 ? { count } : {});

/**
 * What can be done with the section in view, one thing at a time: the statements the server checked and the
 * evidence behind them, what reviewers said, every version, and writing the chapter again. On a wide screen
 * this is the margin beside the text; on a narrow one it follows the text.
 */
export function Tools({
  view,
  section,
  access,
  actions,
  tool,
  onTool,
  comparing,
  onCompare,
  instruction,
  onInstruction,
}: {
  view: StudioView;
  section: StudioSectionView;
  access: SectionAccess;
  actions: StudioActions;
  tool: ToolId;
  onTool: (tool: ToolId) => void;
  comparing: number | null;
  onCompare: (version: number | null) => void;
  instruction: string;
  onInstruction: (text: string) => void;
}) {
  const available = toolsOf(section);
  const active = available.includes(tool) ? tool : (available[0] ?? 'notes');
  const items: Record<ToolId, TabItem<ToolId>> = {
    statements: { value: 'statements', label: 'Statements', ...counted(section.statements.length) },
    notes: { value: 'notes', label: 'Notes', ...counted(section.notes.length) },
    history: {
      value: 'history',
      label: 'History',
      ...counted(section.versions.length > 1 ? section.versions.length : 0),
    },
    rewrite: { value: 'rewrite', label: 'Rewrite', ...counted(section.proposal ? 1 : 0) },
  };
  return (
    <Tabs
      className="sw-tools"
      listClassName="sw-tools__list"
      label={`Tools for ${section.title}`}
      value={active}
      onValueChange={onTool}
      tabs={available.map((id) => items[id])}
    >
      <TabPanel value="statements" className="sw-tools__panel">
        <Statements section={section} evidence={view} />
      </TabPanel>
      <TabPanel value="notes" className="sw-tools__panel">
        <Notes
          section={section}
          canNote={view.capabilities.review && !view.stale}
          maxNote={view.limits.maxNote}
          saving={actions.pending === `note:${section.id}`}
          onAdd={(text) => actions.note(section, text)}
        />
      </TabPanel>
      <TabPanel value="history" className="sw-tools__panel">
        <History
          section={section}
          canRestore={access.canWrite}
          pending={actions.pending}
          comparing={comparing}
          onCompare={onCompare}
          onRestore={(version) => void actions.restore(section, version)}
        />
      </TabPanel>
      <TabPanel value="rewrite" className="sw-tools__panel">
        <Rewrite
          view={view}
          section={section}
          access={access}
          instruction={instruction}
          onInstruction={onInstruction}
          pending={actions.pending}
          onWrite={() => void actions.regenerate(section, instruction.trim() || null)}
        />
      </TabPanel>
    </Tabs>
  );
}
