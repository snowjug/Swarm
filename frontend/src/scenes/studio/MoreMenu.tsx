import { useRef } from 'react';
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
  const trigger = useRef<HTMLButtonElement>(null);
  const next = useRef<(() => void) | null>(null);
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton ref={trigger} label="More" tone="glass">
          <MoreHorizontal size={18} aria-hidden="true" />
        </IconButton>
      </MenuTrigger>
      <MenuContent
        align="end"
        // A menu gives focus back to its button as it closes. What opens a sheet or asks a question opens after that,
        // so that closing it returns the keyboard to the button and not to the top of the page.
        onCloseAutoFocus={(event) => {
          const then = next.current;
          next.current = null;
          if (!then) return;
          event.preventDefault();
          trigger.current?.focus({ preventScroll: true });
          then();
        }}
      >
        {onReport && (
          <MenuItem
            icon={<ScrollText size={16} />}
            onSelect={() => {
              next.current = onReport;
            }}
          >
            Detailed report
          </MenuItem>
        )}
        <MenuItem
          icon={<History size={16} />}
          onSelect={() => {
            next.current = onRecord;
          }}
        >
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
