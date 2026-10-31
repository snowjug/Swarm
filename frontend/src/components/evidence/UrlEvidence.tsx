import { useId, useRef } from 'react';
import type { Ref } from 'react';
import { Globe } from 'lucide-react';
import type { SourceProvenance } from '../../../../shared/scenario';
import type { UrlEvidenceResult } from '../../api/evidence';
import { Notice, Spinner } from '../ui';
import { useUrlEvidence, type UrlEvidenceStatus } from './useUrlEvidence';

export interface UrlEvidenceProps {
  /** Called with a page the server fetched, ready to be one of the project's documents. */
  onAdd: (document: { name: string; content: string; provenance: SourceProvenance }) => void;
  disabled: boolean;
  /** How many more documents the project can take. */
  remainingDocuments: number;
}

const EXCERPT_CHARS = 320;

function hostOf(address: string | undefined): string {
  try {
    return address ? new URL(address).hostname : '';
  } catch {
    return '';
  }
}

/** A fixed, plain form of the time, so that it reads the same wherever it is shown. */
function when(iso: string | undefined): string {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime())
    ? `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : 'Unknown time';
}

function excerptOf(content: string): string {
  const text = content.replace(/\s+/gu, ' ').trim();
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS).trimEnd()}\u2026` : text;
}

export interface UrlEvidenceViewProps {
  address: string;
  status: UrlEvidenceStatus;
  result: UrlEvidenceResult | null;
  error: string | null;
  disabled: boolean;
  remainingDocuments: number;
  onAddressChange: (value: string) => void;
  onFetch: () => void;
  onCancel: () => void;
  onAdd: () => void;
  onDiscard: () => void;
  /** So that focus can return to the field when a page has been added or discarded. */
  inputRef?: Ref<HTMLInputElement>;
}

/** What a person sees, for each state of fetching a page. It holds no state of its own. */
export function UrlEvidenceView(props: UrlEvidenceViewProps) {
  const { address, status, result, error, disabled, remainingDocuments } = props;
  const id = useId();
  const loading = status === 'loading';
  const full = remainingDocuments < 1;
  const locked = disabled || loading || full;
  const canFetch = !locked && address.trim() !== '';
  const provenance = result?.document.provenance;
  const host = hostOf(provenance?.finalUrl ?? provenance?.url);

  return (
    <section
      className="url-evidence"
      aria-labelledby={`${id}-title`}
      aria-busy={loading || undefined}
    >
      <div className="section-heading">
        <h3 id={`${id}-title`}>
          <Globe size={15} aria-hidden="true" /> Add a public web page
        </h3>
      </div>
      <p className="url-evidence-help" id={`${id}-help`}>
        Swarm fetches the text of the page from its own server. It does not run scripts, sign in, or
        read private networks, and it does not check that what the page says is true. If a page does
        not work, you can paste its text instead.
      </p>
      <form
        className="url-evidence-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canFetch) props.onFetch();
        }}
      >
        <div className="field">
          <label htmlFor={`${id}-address`}>Web address</label>
          <input
            ref={props.inputRef}
            id={`${id}-address`}
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="https://example.com/page"
            value={address}
            disabled={disabled || full}
            readOnly={loading}
            aria-describedby={`${id}-help`}
            onChange={(event) => props.onAddressChange(event.target.value)}
          />
        </div>
        <button type="submit" className="button button-secondary" disabled={!canFetch}>
          Fetch page
        </button>
      </form>
      {full && (
        <Notice tone="warning">
          This project already has the most documents it can hold. Remove one to add a page.
        </Notice>
      )}
      {loading && (
        <div className="inline-pending" role="status">
          <Spinner label="Fetching the page" /> Fetching the page. This can take a few seconds.
          <button type="button" className="text-button" onClick={props.onCancel}>
            Cancel
          </button>
        </div>
      )}
      <div className="sr-only" role="status">
        {status === 'ready' ? 'The page was fetched. Review it, then add it as evidence.' : ''}
      </div>
      {status === 'error' && error && (
        <Notice tone="error" title="The page could not be read">
          {error}
        </Notice>
      )}
      {status === 'ready' && result && provenance && (
        <article className="url-evidence-preview" aria-label="The fetched page">
          <h4>{provenance.title || host || result.document.name}</h4>
          <dl className="url-evidence-facts">
            <div>
              <dt>Site</dt>
              <dd>{host || 'Unknown'}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{result.document.content.length.toLocaleString('en-US')} characters</dd>
            </div>
            <div>
              <dt>Retrieved</dt>
              <dd>
                <time dateTime={provenance.retrievedAt}>{when(provenance.retrievedAt)}</time>
              </dd>
            </div>
          </dl>
          <p className="url-evidence-excerpt">{excerptOf(result.document.content)}</p>
          {result.notes.length > 0 && (
            <ul className="url-evidence-notes" aria-label="About this page">
              {result.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          <div className="url-evidence-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={disabled || full}
              onClick={props.onAdd}
            >
              Add as evidence
            </button>
            <button type="button" className="text-button" onClick={props.onDiscard}>
              Discard
            </button>
          </div>
        </article>
      )}
    </section>
  );
}

/** Adds a public web page as evidence: the server fetches it, and the person decides whether to keep it. */
export function UrlEvidence({ onAdd, disabled, remainingDocuments }: UrlEvidenceProps) {
  const state = useUrlEvidence();
  const inputRef = useRef<HTMLInputElement>(null);
  const finish = () => {
    state.discard();
    inputRef.current?.focus();
  };
  return (
    <UrlEvidenceView
      address={state.address}
      status={state.status}
      result={state.result}
      error={state.error}
      disabled={disabled}
      remainingDocuments={remainingDocuments}
      inputRef={inputRef}
      onAddressChange={state.setAddress}
      onFetch={state.fetchPage}
      onCancel={state.cancel}
      onAdd={() => {
        if (!state.result) return;
        onAdd(state.result.document);
        finish();
      }}
      onDiscard={finish}
    />
  );
}
