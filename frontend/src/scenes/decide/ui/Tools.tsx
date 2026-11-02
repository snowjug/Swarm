import {
  ChevronDown,
  Download,
  ExternalLink,
  FileJson,
  FileText,
  FileType2,
  MoreHorizontal,
  PenLine,
  Printer,
  RefreshCw,
  Scale,
  Sparkles,
} from 'lucide-react';
import {
  Button,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from '../../../design/ui';
import type { BriefExportFormat } from '../../../../../shared/brief';
import type { ReportTool } from '../model/report-tool';
import './tools.css';

/** Hands a link to the browser: the server names the file and says whether it is saved or shown. */
function follow(url: string, newTab: boolean): void {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener noreferrer';
  if (newTab) link.target = '_blank';
  document.body.append(link);
  link.click();
  link.remove();
}

/** The brief as a file, or as a page to print. The links are the server's: nothing is made here. */
export function ExportMenu({
  url,
  allowed,
  size = 'sm',
}: {
  url: (format: BriefExportFormat) => string;
  allowed: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button
          variant="primary"
          size={size}
          icon={<Download size={15} aria-hidden="true" />}
          iconEnd={<ChevronDown size={14} aria-hidden="true" />}
        >
          Export
        </Button>
      </MenuTrigger>
      <MenuContent align="end" className="sw-decide-menu">
        <MenuLabel>Save the brief</MenuLabel>
        <MenuItem
          icon={<FileText size={16} />}
          disabled={!allowed}
          onSelect={() => follow(url('md'), false)}
        >
          Markdown
        </MenuItem>
        <MenuItem
          icon={<FileJson size={16} />}
          disabled={!allowed}
          onSelect={() => follow(url('json'), false)}
        >
          JSON, with the data behind the charts
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Print</MenuLabel>
        <MenuItem
          icon={<ExternalLink size={16} />}
          disabled={!allowed}
          onSelect={() => follow(url('html'), true)}
        >
          Printable page
        </MenuItem>
        <MenuItem icon={<Printer size={16} />} shortcut="Ctrl P" onSelect={() => window.print()}>
          Print this page
        </MenuItem>
        {!allowed && (
          <p className="sw-decide-menu__note">Your role can read the brief but not export it.</p>
        )}
      </MenuContent>
    </Menu>
  );
}

export interface ToolsProps {
  /** The review's standing in a few words, or null before it has been read. */
  reviewText: string | null;
  openCount: number | null;
  may: { generate: boolean; export: boolean };
  generating: boolean;
  /** What the detailed report offers: to edit it, to write it, to read how far it got, or nothing. */
  report: ReportTool;
  url: (format: BriefExportFormat) => string;
  onReview: () => void;
  onStudio: () => void;
  onReport: () => void;
  onGenerate: () => void;
  onOpenAll: () => void;
  size?: 'sm' | 'md';
}

/** What can be done with the brief as a whole: review it, edit it, read the detail behind it, save it. */
export function Tools({
  reviewText,
  openCount,
  may,
  generating,
  report,
  url,
  onReview,
  onStudio,
  onReport,
  onGenerate,
  onOpenAll,
  size = 'sm',
}: ToolsProps) {
  // What the count means, said after the visible words so that the name still begins with them.
  const spoken = reviewText
    ? openCount
      ? ` ${reviewText.replace(/^\d+\s+/u, '')}`
      : `, ${reviewText}`
    : '';
  // The report is edited where it is written. Where it is not, the one thing to do about it is to write it: the
  // studio would only say that there is nothing to work on.
  const detail = report === 'edit' || report === 'read';
  return (
    <div className="sw-decide-tools" role="group" aria-label="Tools for the brief">
      <Button
        variant="glass"
        size={size}
        icon={<Scale size={15} aria-hidden="true" />}
        onClick={onReview}
      >
        Review
        {openCount ? (
          <>
            {' '}
            <span className="sw-decide-tools__count num">{openCount}</span>
          </>
        ) : null}
        {spoken ? <span className="sr-only">{spoken}</span> : null}
      </Button>
      {report === 'edit' && (
        <Button
          variant="glass"
          size={size}
          icon={<PenLine size={15} aria-hidden="true" />}
          onClick={onStudio}
          className="sw-decide-tools__wide"
        >
          Edit report
        </Button>
      )}
      {report === 'write' && (
        <Button
          variant="glass"
          size={size}
          icon={<Sparkles size={15} aria-hidden="true" />}
          onClick={onReport}
          className="sw-decide-tools__wide"
        >
          Write the detailed report
        </Button>
      )}
      {detail && (
        <Button
          variant="ghost"
          size={size}
          icon={<FileType2 size={15} aria-hidden="true" />}
          onClick={onReport}
          className="sw-decide-tools__wide"
        >
          Detailed report
        </Button>
      )}
      <ExportMenu url={url} allowed={may.export} size={size} />
      <Menu>
        <MenuTrigger asChild>
          <IconButton label="More" size={size === 'sm' ? 'md' : 'lg'} tone="plain">
            <MoreHorizontal size={18} aria-hidden="true" />
          </IconButton>
        </MenuTrigger>
        <MenuContent align="end" className="sw-decide-menu">
          {report === 'edit' && (
            <MenuItem
              className="sw-decide-tools__narrow"
              icon={<PenLine size={16} />}
              onSelect={onStudio}
            >
              Edit report
            </MenuItem>
          )}
          {report === 'write' && (
            <MenuItem
              className="sw-decide-tools__narrow"
              icon={<Sparkles size={16} />}
              onSelect={onReport}
            >
              Write the detailed report
            </MenuItem>
          )}
          {detail && (
            <MenuItem
              className="sw-decide-tools__narrow"
              icon={<FileType2 size={16} />}
              onSelect={onReport}
            >
              Detailed report
            </MenuItem>
          )}
          <MenuItem
            icon={<RefreshCw size={16} />}
            disabled={!may.generate || generating}
            onSelect={onGenerate}
          >
            Write the brief again
          </MenuItem>
          <MenuItem onSelect={onOpenAll} icon={<ChevronDown size={16} />}>
            Open every chapter
          </MenuItem>
          {!may.generate && (
            <p className="sw-decide-menu__note">
              Your role can read the brief but not rewrite it
              {report === 'none' ? ', nor write its detailed report' : ''}.
            </p>
          )}
        </MenuContent>
      </Menu>
    </div>
  );
}
