import { ChevronDown, Download, ExternalLink, FileJson, FileText } from 'lucide-react';
import { api } from '../../api';
import { Button, Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from '../../design/ui';

/**
 * The ways out of the studio: the text as Markdown, the whole record as JSON, and a printable page that
 * says what was approved. The printable page opens by itself, in a tab that cannot reach this one.
 */
export function ExportMenu({
  projectId,
  busy,
  disabled,
  onExport,
}: {
  projectId: string;
  busy: boolean;
  disabled: boolean;
  onExport: (format: 'markdown' | 'json') => void;
}) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button
          variant="glass"
          size="sm"
          icon={<Download size={15} aria-hidden="true" />}
          iconEnd={<ChevronDown size={14} aria-hidden="true" />}
          busy={busy}
          busyLabel="Exporting"
          disabled={disabled}
        >
          Export
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>Export this report</MenuLabel>
        <MenuItem icon={<FileText size={16} />} onSelect={() => onExport('markdown')}>
          Markdown
        </MenuItem>
        <MenuItem icon={<FileJson size={16} />} onSelect={() => onExport('json')}>
          JSON, with the record
        </MenuItem>
        <MenuItem
          icon={<ExternalLink size={16} />}
          onSelect={() =>
            window.open(api.studioExportUrl(projectId, 'memo'), '_blank', 'noopener,noreferrer')
          }
        >
          Printable memo
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
