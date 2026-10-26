import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, FileSearch, FileText, Search } from 'lucide-react';
import type { EvidenceMatch, SourceDocument } from '../../../shared/types';
import { api, errorMessage } from '../api';
import { count } from '../lib/format';
import { EmptyPanel, Notice, Spinner } from './ui';

export function EvidenceView({
  projectId,
  documents,
  initialQuery = '',
  initialDocumentId,
}: {
  projectId: string;
  documents: SourceDocument[];
  initialQuery?: string;
  initialDocumentId?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [revision, setRevision] = useState(0);
  const [matches, setMatches] = useState<EvidenceMatch[]>([]);
  const [returnedQuery, setReturnedQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'excerpts' | 'documents'>(
    initialDocumentId ? 'documents' : 'excerpts',
  );
  const [documentId, setDocumentId] = useState(initialDocumentId ?? documents[0]?.id ?? '');
  const [highlight, setHighlight] = useState<{
    documentId: string;
    start: number;
    end: number;
    id: string;
  } | null>(null);
  const excerptRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void api.evidence(projectId, submittedQuery, controller.signal).then(
      (response) => {
        if (controller.signal.aborted) return;
        setMatches(response.matches);
        setReturnedQuery(response.query);
        setLoading(false);
      },
      (failure: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(failure));
        setLoading(false);
      },
    );
    return () => controller.abort();
  }, [projectId, submittedQuery, revision]);

  useEffect(() => {
    if (view === 'documents' && highlight)
      excerptRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [view, highlight]);

  const selectedDocument = documents.find((document) => document.id === documentId) ?? documents[0];
  const activeHighlight = highlight?.documentId === selectedDocument?.id ? highlight : null;
  const openOriginal = (match: EvidenceMatch) => {
    setDocumentId(match.documentId);
    setHighlight({
      documentId: match.documentId,
      start: match.start,
      end: match.end,
      id: match.id,
    });
    setView('documents');
  };
  const search = () => {
    setSubmittedQuery(query.trim());
    setRevision((value) => value + 1);
    setView('excerpts');
  };
  return (
    <div className="view-stack">
      <div className="section-heading">
        <div>
          <span className="eyebrow">THE SOURCE DESK</span>
          <h2>Go back to the material.</h2>
        </div>
        <span className="method-tag">
          <BookOpen size={13} aria-hidden="true" /> {documents.length} SOURCE DOCUMENT
          {documents.length === 1 ? '' : 'S'}
        </span>
      </div>
      <p className="view-description">
        Search local evidence chunks or read the original text. Source IDs refer to excerpts, not
        external citations. No web search or retrieval is performed.
      </p>
      <div className="evidence-view-switch" role="group" aria-label="Evidence display">
        <button
          type="button"
          className={view === 'excerpts' ? 'active' : ''}
          aria-pressed={view === 'excerpts'}
          onClick={() => setView('excerpts')}
        >
          <FileSearch size={15} aria-hidden="true" /> Search excerpts
        </button>
        <button
          type="button"
          className={view === 'documents' ? 'active' : ''}
          aria-pressed={view === 'documents'}
          onClick={() => setView('documents')}
        >
          <FileText size={15} aria-hidden="true" /> Original documents
        </button>
      </div>
      {view === 'excerpts' ? (
        <>
          <form
            className="evidence-search-form card"
            onSubmit={(event) => {
              event.preventDefault();
              search();
            }}
          >
            <label htmlFor="evidence-query">Search your source material</label>
            <div>
              <span className="search-input-wrap">
                <Search size={18} aria-hidden="true" />
                <input
                  id="evidence-query"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  maxLength={300}
                  placeholder="A topic, phrase, or source ID…"
                />
              </span>
              <button type="submit" className="button button-primary" disabled={loading}>
                {loading ? (
                  <Spinner label="Searching local evidence" />
                ) : (
                  <Search size={16} aria-hidden="true" />
                )}{' '}
                Search
              </button>
            </div>
            <p className="field-help">
              Leave empty to browse the available excerpts. Search ranking is an aid to inspection,
              not a confidence score.
            </p>
          </form>
          {error && (
            <Notice
              tone="error"
              title="Could not load evidence"
              action={
                <button
                  className="button button-secondary button-small"
                  type="button"
                  onClick={() => setRevision((value) => value + 1)}
                >
                  Retry search
                </button>
              }
            >
              {error}
            </Notice>
          )}
          {loading ? (
            <div className="loading-panel">
              <Spinner label="Loading source excerpts" />
              <span>Looking through your local sources…</span>
            </div>
          ) : (
            !error && (
              <div aria-live="polite">
                <div className="evidence-results-heading">
                  <h3>
                    {matches.length} excerpt{matches.length === 1 ? '' : 's'} found
                  </h3>
                  {returnedQuery && <span className="muted">for “{returnedQuery}”</span>}
                </div>
                {matches.length ? (
                  <div className="evidence-results">
                    {matches.map((match) => (
                      <article className="card evidence-match" key={match.id}>
                        <div className="evidence-match-header">
                          <span>
                            <FileText size={16} aria-hidden="true" />
                            <strong>{match.documentName}</strong>
                          </span>
                          <code>{match.id}</code>
                        </div>
                        <blockquote className="plain-text">{match.text}</blockquote>
                        <div className="evidence-match-footer">
                          <span>
                            Characters {count(match.start)}–{count(match.end)}
                          </span>
                          <button
                            className="text-button"
                            type="button"
                            onClick={() => openOriginal(match)}
                          >
                            Open original <ArrowUpRight size={14} aria-hidden="true" />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <EmptyPanel
                    title="No matching excerpts"
                    icon={<FileSearch size={26} aria-hidden="true" />}
                  >
                    Try a shorter topic, clear the search, or inspect the original documents.
                    Excerpts may not exist until source intake is complete.
                  </EmptyPanel>
                )}
              </div>
            )
          )}
        </>
      ) : (
        <div className="card source-document-view">
          <div className="source-document-toolbar">
            <div className="field">
              <label htmlFor="source-document">Original source document</label>
              <select
                id="source-document"
                value={selectedDocument?.id ?? ''}
                onChange={(event) => {
                  setDocumentId(event.target.value);
                  setHighlight(null);
                }}
              >
                {documents.map((document) => (
                  <option value={document.id} key={document.id}>
                    {document.name}
                  </option>
                ))}
              </select>
            </div>
            {selectedDocument && (
              <span className="quiet-label">
                {count(selectedDocument.content.length)} CHARACTERS · PLAIN TEXT
              </span>
            )}
          </div>
          {activeHighlight && (
            <div className="document-highlight-label">
              <span>
                Showing excerpt <code>{activeHighlight.id}</code>
              </span>
              <button className="text-button" type="button" onClick={() => setHighlight(null)}>
                Clear highlight
              </button>
            </div>
          )}
          {selectedDocument ? (
            <pre className="source-document-content">
              {activeHighlight ? (
                <>
                  {selectedDocument.content.slice(0, activeHighlight.start)}
                  <mark ref={excerptRef} tabIndex={-1}>
                    {selectedDocument.content.slice(activeHighlight.start, activeHighlight.end)}
                  </mark>
                  {selectedDocument.content.slice(activeHighlight.end)}
                </>
              ) : (
                selectedDocument.content
              )}
            </pre>
          ) : (
            <EmptyPanel title="No source documents">
              This project does not contain any source material.
            </EmptyPanel>
          )}
        </div>
      )}
    </div>
  );
}
