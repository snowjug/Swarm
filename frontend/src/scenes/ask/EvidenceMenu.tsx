import { useEffect, useId, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { FileUp, Globe, Plus, StickyNote, X } from 'lucide-react';
import { Button, Field, Input, Notice, Orbit, Segmented, Textarea } from '../../design/ui';
import { fetchOnEnter, useUrlEvidence } from '../../hooks/useUrlEvidence';
import { sizeText, splitRequestId } from './evidence';
import { Surface } from './Surface';
import type { Evidence } from './useEvidence';
import './EvidenceMenu.css';

type Way = 'files' | 'paste' | 'page';

/**
 * What went wrong, a line for each thing, in the words the server gave it. The number to quote when asking about it
 * is set apart so that the words end where they end; `advice` is added to a line that does not give its own.
 */
function Problem({ text, advice }: { text: string; advice?: string }) {
  return (
    <span className="sw-evm__problem">
      {text.split('\n').map((line, index) => {
        const { words, requestId } = splitRequestId(line);
        const needsAdvice = advice !== undefined && !/\bpaste\b/iu.test(words);
        return (
          <span className="sw-evm__line" key={`${index}-${line}`}>
            {words}
            {needsAdvice ? ` ${advice}` : ''}
            {requestId && <span className="sw-evm__rid num">Request ID: {requestId}</span>}
          </span>
        );
      })}
    </span>
  );
}

function hostOf(address: string | undefined): string {
  try {
    return address ? new URL(address).hostname : '';
  } catch {
    return '';
  }
}

const when = (iso: string | undefined): string => {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime())
    ? `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : 'unknown time';
};

const excerptOf = (content: string): string => {
  const text = content.replace(/\s+/gu, ' ').trim();
  return text.length > 280 ? `${text.slice(0, 280).trimEnd()}\u2026` : text;
};

/**
 * Three ways to bring evidence in: files, pasted text, a public web page. Each ends in the same place, the
 * list of documents. The server reads PDFs, tables and pages; the browser reads plain text. Nothing is
 * kept but the extracted text.
 */
function EvidencePanel({
  evidence,
  urlEnabled,
  disabled,
  onClose,
}: {
  evidence: Evidence;
  urlEnabled: boolean;
  disabled: boolean;
  onClose: () => void;
}) {
  const [way, setWay] = useState<Way>('files');
  const [pasteName, setPasteName] = useState(evidence.suggestedName);
  const [paste, setPaste] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const url = useUrlEvidence();
  const id = useId();
  const full = evidence.full;
  const busy = Boolean(evidence.reading);
  const ways = [
    { value: 'files' as const, label: 'Files', icon: <FileUp size={15} aria-hidden="true" /> },
    { value: 'paste' as const, label: 'Paste', icon: <StickyNote size={15} aria-hidden="true" /> },
    ...(urlEnabled
      ? [
          {
            value: 'page' as const,
            label: 'Web page',
            icon: <Globe size={15} aria-hidden="true" />,
          },
        ]
      : []),
  ];
  const provenance = url.result?.document.provenance;
  const canFetch = !disabled && !full && url.status !== 'loading' && url.address.trim() !== '';

  useEffect(() => {
    if (way === 'paste') setPasteName((old) => old || evidence.suggestedName);
  }, [way, evidence.suggestedName]);

  return (
    <div className="sw-evm">
      <div className="sw-evm__head">
        <Segmented
          label="How to add evidence"
          value={way}
          onChange={setWay}
          options={ways}
          size="sm"
        />
        <span
          className="sw-evm__count num"
          aria-label={`${evidence.documents.length} of ${evidence.limits.maxDocuments} sources`}
        >
          {evidence.documents.length}/{evidence.limits.maxDocuments}
        </span>
      </div>

      {way === 'files' && (
        <div className="sw-evm__pane">
          <button
            type="button"
            className="sw-evm__drop"
            disabled={disabled || busy || full}
            onClick={() => picker.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void evidence.addFiles(event.dataTransfer.files);
            }}
          >
            {busy ? <Orbit size={26} label="Reading" /> : <FileUp size={26} aria-hidden="true" />}
            <strong>{busy ? `Reading ${evidence.reading}` : 'Drop files, or choose'}</strong>
            <span>
              TXT · MD · CSV · JSON · PDF, up to {evidence.limits.maxChars.toLocaleString('en-GB')}{' '}
              characters each
            </span>
          </button>
          <input
            ref={picker}
            className="sr-only"
            type="file"
            multiple
            tabIndex={-1}
            aria-label="Choose evidence files"
            accept=".txt,.md,.markdown,.pdf,.csv,.json"
            onChange={(event) => {
              void evidence.addFiles(event.target.files);
              event.target.value = '';
            }}
          />
          {busy && (
            <Button variant="ghost" size="sm" icon={<X size={14} />} onClick={evidence.cancel}>
              Stop reading
            </Button>
          )}
        </div>
      )}

      {way === 'paste' && (
        <div className="sw-evm__pane">
          <Field label="Name" labelHidden>
            <Input
              value={pasteName}
              maxLength={120}
              disabled={disabled}
              placeholder="notes.txt"
              onChange={(event) => setPasteName(event.target.value)}
              aria-label="Source filename"
            />
          </Field>
          <Field label="Source text" labelHidden>
            <Textarea
              value={paste}
              maxRows={7}
              maxLength={evidence.limits.maxChars}
              disabled={disabled}
              placeholder="Paste the source (80 characters or more). Not your question."
              onChange={(event) => setPaste(event.target.value)}
              aria-label="Source text, not your question"
            />
          </Field>
          <div className="sw-evm__row">
            <span className="sw-caption num">
              {paste.length.toLocaleString('en-GB')} /{' '}
              {evidence.limits.maxChars.toLocaleString('en-GB')}
            </span>
            <Button
              size="sm"
              variant="primary"
              icon={<Plus size={14} />}
              disabled={disabled || full || !paste.trim()}
              onClick={() => {
                if (evidence.addPaste(pasteName, paste)) {
                  setPaste('');
                  setPasteName('');
                }
              }}
            >
              Attach
            </Button>
          </div>
        </div>
      )}

      {way === 'page' && (
        <div className="sw-evm__pane" aria-busy={url.status === 'loading' || undefined}>
          <div className="sw-evm__url">
            <Field label="Web address" labelHidden>
              <Input
                type="text"
                inputMode="url"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="https://example.com/page"
                aria-label="Web address"
                value={url.address}
                disabled={disabled || full}
                readOnly={url.status === 'loading'}
                onChange={(event) => url.setAddress(event.target.value)}
                onKeyDown={(event) => fetchOnEnter(event.nativeEvent, canFetch, url.fetchPage)}
              />
            </Field>
            <Button
              size="md"
              variant="glass"
              disabled={!canFetch}
              busy={url.status === 'loading'}
              busyLabel="Fetching the page"
              onClick={url.fetchPage}
            >
              Fetch
            </Button>
          </div>
          <p className="sw-caption">
            The server fetches the text. It runs no scripts and signs in nowhere, and it does not
            check that the page is true.
          </p>
          {url.status === 'loading' && (
            <Button variant="ghost" size="sm" onClick={url.cancel}>
              Cancel
            </Button>
          )}
          {url.status === 'error' && url.error && (
            <Notice tone="error" title="The page could not be read">
              <Problem text={url.error} advice="You can paste its text instead." />
            </Notice>
          )}
          {url.status === 'ready' && url.result && provenance && (
            <article className="sw-evm__preview" aria-label="The fetched page">
              <p className="sw-evm__title">
                {provenance.title ||
                  hostOf(provenance.finalUrl ?? provenance.url) ||
                  url.result.document.name}
              </p>
              <p className="sw-evm__facts num">
                {hostOf(provenance.finalUrl ?? provenance.url) || 'Unknown site'} ·{' '}
                {sizeText(url.result.document.content.length)} ·{' '}
                <time dateTime={provenance.retrievedAt}>{when(provenance.retrievedAt)}</time>
              </p>
              <p className="sw-evm__excerpt">{excerptOf(url.result.document.content)}</p>
              {url.result.notes.length > 0 && (
                <ul className="sw-evm__notes" aria-label="About this page">
                  {url.result.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
              <div className="sw-evm__row">
                <Button variant="ghost" size="sm" onClick={url.discard}>
                  Discard
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={disabled || full}
                  onClick={() => {
                    if (!url.result) return;
                    evidence.addDocument(url.result.document);
                    url.discard();
                  }}
                >
                  Add as evidence
                </Button>
              </div>
            </article>
          )}
        </div>
      )}

      {full && (
        <p className="sw-caption">
          The most sources a project can hold is {evidence.limits.maxDocuments}. Remove one to add
          another.
        </p>
      )}
      {evidence.error && (
        <Notice tone="error">
          <Problem text={evidence.error} />
        </Notice>
      )}
      <p className="sw-caption sw-evm__foot" id={`${id}-foot`}>
        Only the extracted text is kept. Uploads stay on this server.
      </p>
      <div className="sw-evm__done">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

/** The evidence menu and the button that opens it (pass the button as `trigger`). */
export function EvidenceMenu({
  evidence,
  urlEnabled,
  disabled,
  trigger,
  open,
  onOpenChange,
}: {
  evidence: Evidence;
  urlEnabled: boolean;
  disabled: boolean;
  trigger: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [own, setOwn] = useState(false);
  const isOpen = open ?? own;
  const change = (next: boolean) => {
    if (open === undefined) setOwn(next);
    onOpenChange?.(next);
    if (!next) evidence.clearError();
  };
  return (
    <Surface
      title="Add evidence"
      trigger={trigger}
      open={isOpen}
      onOpenChange={change}
      width="26rem"
    >
      <EvidencePanel
        evidence={evidence}
        urlEnabled={urlEnabled}
        disabled={disabled}
        onClose={() => change(false)}
      />
    </Surface>
  );
}
