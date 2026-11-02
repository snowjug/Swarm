import {
  Download,
  ExternalLink,
  FileJson,
  FileText,
  History,
  MoreHorizontal,
  ScrollText,
} from 'lucide-react';
import { api } from '../../api';
import {
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from '../../design/ui';

/** On a phone, what the header's buttons do, in one menu: the detailed report, the record and the exports. */
export function MoreMenu({
  projectId,
  canExport,
  onReport,
  onRecord,
  onExport,
}: {
  projectId: string;
  canExport: boolean;
  onReport: (() => void) | null;
  onRecord: () => void;
  onExport: (format: 'markdown' | 'json') => void;
}) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label="More" tone="glass">
          <MoreHorizontal size={18} aria-hidden="true" />
        </IconButton>
      </MenuTrigger>
      <MenuContent align="end">
        {onReport && (
          <MenuItem icon={<ScrollText size={16} />} onSelect={onReport}>
            Detailed report
          </MenuItem>
        )}
        <MenuItem icon={<History size={16} />} onSelect={onRecord}>
          Review record
        </MenuItem>
        {canExport && (
          <>
            <MenuSeparator />
            <MenuLabel>Export</MenuLabel>
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
          </>
        )}
        {!canExport && (
          <MenuItem icon={<Download size={16} />} disabled>
            Export is not available to you
          </MenuItem>
        )}
      </MenuContent>
    </Menu>
  );
}
