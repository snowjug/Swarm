import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button, Chip, Sheet, SheetClose, SheetContent, Textarea } from '../../design/ui';
import { SOURCE_KIND_LABELS } from '../../lib/product';
import { editedPage, sizeText, type DocumentInput } from './evidence';
import './DocumentSheet.css';

/**
 * One source, opened to be read and corrected: the text that was extracted or supplied is what Swarm will
 * work from, so a person can fix an extraction that read badly. Removing it is here too.
 */
export function DocumentSheet({
  document: opened,
  maxChars,
  disabled,
  onChange,
  onRemove,
  onClose,
}: {
  document: DocumentInput | null;
  maxChars: number;
  disabled: boolean;
  onChange: (content: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  // The sheet leaves the way it came: what it showed stays until it is gone, also when the source was taken away.
  const [last, setLast] = useState(opened);
  if (opened && opened !== last) setLast(opened);
  const document = opened ?? last;
  return (
    <Sheet open={opened !== null} onOpenChange={(open) => !open && onClose()}>
      {document && (
        <SheetContent
          width="lg"
          eyebrow={document.provenance ? SOURCE_KIND_LABELS[document.provenance.kind] : 'Source'}
          title={document.name}
          description={`${sizeText(document.content.length)}${document.pageCount ? ` · ${document.pageCount} pages` : ''}`}
          footer={
            <>
              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 size={14} aria-hidden="true" />}
                disabled={disabled}
                onClick={onRemove}
              >
                Remove
              </Button>
              <SheetClose asChild>
                <Button variant="primary" size="sm">
                  Done
                </Button>
              </SheetClose>
            </>
          }
        >
          <div className="sw-docsheet">
            {document.provenance?.kind === 'sample' && (
              <Chip tone="caution">Sample evidence: invented, describes no real case</Chip>
            )}
            {document.provenance?.url && (
              <p className="sw-caption sw-docsheet__url">
                {document.provenance.finalUrl ?? document.provenance.url}
              </p>
            )}
            {editedPage(document) && (
              <p className="sw-caption">
                You changed the text of a page Swarm fetched, so it is kept as pasted text, not as a
                retrieved page.
              </p>
            )}
            <Textarea
              className="sw-docsheet__text"
              aria-label="The text Swarm will work from"
              value={document.content}
              maxLength={maxChars}
              maxRows={26}
              disabled={disabled}
              onChange={(event) => onChange(event.target.value)}
            />
            <p className="sw-caption num">
              {document.content.length.toLocaleString('en-GB')} / {maxChars.toLocaleString('en-GB')}
            </p>
          </div>
        </SheetContent>
      )}
    </Sheet>
  );
}
