import { ChevronDown, Download, FileJson, FileText, Printer } from 'lucide-react';
import {
  Button,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from '../../design/ui';
import type { ExportFormat } from './useReportExport';

/**
 * The ways out of the report: the text as Markdown, the whole project as a JSON snapshot, and the page itself
 * on paper. Markdown waits until the report is complete; the snapshot is available for a partial one.
 */
export function ExportMenu({
  complete,
  pending,
  onExport,
  size = 'sm',
}: {
  complete: boolean;
  pending: ExportFormat | null;
  onExport: (format: ExportFormat) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button
          variant="glass"
          size={size}
          icon={<Download size={15} aria-hidden="true" />}
          iconEnd={<ChevronDown size={14} aria-hidden="true" />}
          busy={pending !== null}
          busyLabel="Exporting"
        >
          Export
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>Export this report</MenuLabel>
        <MenuItem
          icon={<FileText size={16} />}
          disabled={!complete}
          onSelect={() => onExport('markdown')}
        >
          {complete ? 'Markdown' : 'Markdown, when complete'}
        </MenuItem>
        <MenuItem icon={<FileJson size={16} />} onSelect={() => onExport('json')}>
          Snapshot, as JSON
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Printer size={16} />} shortcut="Ctrl P" onSelect={() => window.print()}>
          Print this page
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
