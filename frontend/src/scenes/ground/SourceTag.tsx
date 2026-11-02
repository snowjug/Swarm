import { ClipboardPaste, FileText, FlaskConical, Globe, History, Upload } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Chip } from '../../design/ui';
import type { DocumentFacts } from './model';

const ICONS: Record<string, LucideIcon> = {
  upload: Upload,
  paste: ClipboardPaste,
  url: Globe,
  sample: FlaskConical,
  historical: History,
};

/**
 * Where a document came from, in a word and a glyph. A sample says it is synthetic; a page the server fetched
 * names its host; nothing claims more than the record holds.
 */
export function SourceTag({ doc }: { doc: DocumentFacts }) {
  const Icon = (doc.kind && ICONS[doc.kind]) || FileText;
  const label = doc.synthetic
    ? 'Synthetic sample'
    : doc.kind === 'url' && doc.host
      ? doc.host
      : doc.shortKind;
  return (
    <Chip size="sm" icon={<Icon aria-hidden="true" />} title={doc.longKind}>
      {label}
    </Chip>
  );
}
