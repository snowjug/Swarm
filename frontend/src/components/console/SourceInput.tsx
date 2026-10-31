import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { FileText, Plus, Trash2, Upload, X } from 'lucide-react';
import {
  documentInputSchema,
  MAX_DOCUMENTS,
  MAX_DOCUMENT_CHARS,
  MAX_TOTAL_CHARS,
} from '../../../../shared/types';
import type { AppConfig, CreateProjectInput } from '../../../../shared/types';
import { api, errorMessage } from '../../api';
import { evidenceApi } from '../../api/evidence';
import { Notice, Spinner } from '../ui';

type DocumentInput = CreateProjectInput['documents'][number];

function base64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  return btoa(chunks.join(''));
}

export function SourceInput({
  config,
  documents,
  onChange,
  disabled,
  onPending,
  errorResetRef,
}: {
  config: AppConfig | null;
  documents: DocumentInput[];
  onChange: (documents: DocumentInput[]) => void;
  disabled: boolean;
  onPending: (pending: boolean) => void;
  errorResetRef?: RefObject<(() => void) | null>;
}) {
  const [pasteName, setPasteName] = useState('notes.txt');
  const [paste, setPaste] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const limits = config?.limits;
  const maxDocuments = limits?.maxDocuments ?? MAX_DOCUMENTS;
  const maxChars = limits?.maxDocumentChars ?? MAX_DOCUMENT_CHARS;
  const maxTotal = limits?.maxTotalChars ?? MAX_TOTAL_CHARS;
  const total = documents.reduce((sum, document) => sum + document.content.length, 0);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!errorResetRef) return;
    const clear = () => setError(null);
    errorResetRef.current = clear;
    return () => {
      if (errorResetRef.current === clear) errorResetRef.current = null;
    };
  }, [errorResetRef]);
  const changeDocuments = (next: DocumentInput[]) => {
    setError(null);
    onChange(next);
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length || reading || disabled) return;
    if (documents.length + files.length > maxDocuments) {
      setError(`Use at most ${maxDocuments} source documents. No files were added.`);
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    const request = new AbortController();
    controller.current = request;
    setError(null);
    onPending(true);
    const added: DocumentInput[] = [];
    const failures: string[] = [];
    try {
      for (const file of Array.from(files)) {
        if (request.signal.aborted) return;
        setReading(file.name);
        try {
          const pdf = /\.pdf$/iu.test(file.name);
          // A CSV or JSON file is read to text by the server, as a PDF is.
          const table = /\.(csv|json)$/iu.test(file.name);
          if (!pdf && !table && !/\.(txt|md|markdown)$/iu.test(file.name))
            throw new Error('Use UTF-8 TXT, Markdown, or a text-based PDF.');
          if (pdf && !config?.capabilities.pdf)
            throw new Error('PDF extraction is unavailable on this server.');
          if (pdf && file.size > (limits?.maxPdfBytes ?? 2_000_000))
            throw new Error('PDF files must be at most 2 MB before extraction.');
          if (table && file.size > (limits?.maxPdfBytes ?? 2_000_000))
            throw new Error('CSV and JSON files must be at most 2 MB.');
          if (!pdf && !table && file.size > maxChars * 4)
            throw new Error(
              `Text sources must be at most ${maxChars.toLocaleString()} characters.`,
            );
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (request.signal.aborted) return;
          let document: DocumentInput;
          if (table) {
            const read = await evidenceApi.extractDataFile(
              file.name,
              base64(bytes),
              request.signal,
            );
            document = { name: read.name, content: read.content };
          } else if (pdf) {
            const extracted = await api.extractPdf(file.name, base64(bytes), request.signal);
            document = {
              name: extracted.name,
              content: extracted.content,
              pageCount: extracted.pageCount,
            };
          } else {
            let content: string;
            try {
              content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            } catch {
              throw new Error('This file is not valid UTF-8 text. Save it as UTF-8 and try again.');
            }
            document = { name: file.name, content };
          }
          const validated = documentInputSchema.safeParse(document);
          if (!validated.success)
            throw new Error(validated.error.issues.map((issue) => issue.message).join(' '));
          const nextTotal =
            total +
            added.reduce((sum, item) => sum + item.content.length, 0) +
            validated.data.content.length;
          if (nextTotal > maxTotal)
            throw new Error(
              `Combined source text exceeds ${maxTotal.toLocaleString()} characters.`,
            );
          added.push(validated.data);
        } catch (failure) {
          if (request.signal.aborted) return;
          failures.push(`${file.name}: ${errorMessage(failure)}`);
        }
      }
      if (!request.signal.aborted) {
        if (added.length) onChange([...documents, ...added]);
        if (failures.length) setError(failures.join('\n'));
      }
    } finally {
      if (!request.signal.aborted) {
        setReading(null);
        onPending(false);
      }
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const addPaste = () => {
    const parsed = documentInputSchema.safeParse({ name: pasteName, content: paste });
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join(' '));
      return;
    }
    if (documents.length >= maxDocuments || total + parsed.data.content.length > maxTotal) {
      setError(
        `Use at most ${maxDocuments} documents and ${maxTotal.toLocaleString()} total characters.`,
      );
      return;
    }
    onChange([...documents, parsed.data]);
    setPaste('');
    setPasteName(`notes-${documents.length + 2}.txt`);
    setError(null);
  };

  const cancel = () => {
    controller.current?.abort();
    setReading(null);
    onPending(false);
    setError('File intake cancelled. Files already attached are unchanged.');
    if (fileInput.current) fileInput.current.value = '';
  };

  return (
    <section
      className="source-input"
      aria-label="Source material"
      onChangeCapture={() => setError(null)}
    >
      <div className="section-heading">
        <h3>01 / Source material</h3>
        <span className="mono muted">
          {documents.length}/{maxDocuments} FILES · {total.toLocaleString()} CHARS
        </span>
      </div>
      <div className="upload-zone">
        <Upload size={21} aria-hidden="true" />
        <div>
          <strong>Attach TXT, MD or text-based PDF</strong>
          <p>
            80–{maxChars.toLocaleString()} characters each. PDFs: 2 MB / {limits?.maxPdfPages ?? 40}{' '}
            pages. No OCR.
          </p>
        </div>
        <label
          className={`button button-secondary button-small ${disabled || reading ? 'disabled-label' : ''}`}
        >
          Choose files
          <input
            ref={fileInput}
            className="sr-only"
            type="file"
            multiple
            accept=".txt,.md,.markdown,.pdf,.csv,.json"
            disabled={disabled || Boolean(reading) || documents.length >= maxDocuments}
            onChange={(event) => void addFiles(event.target.files)}
          />
        </label>
      </div>
      {reading && (
        <div className="inline-pending" role="status">
          <Spinner label="Reading source" /> Reading / extracting {reading}
          <button type="button" className="text-button" onClick={cancel}>
            <X size={13} /> Cancel
          </button>
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {documents.map((document, index) => (
        <details className="source-file" key={`${index}-${document.name}`}>
          <summary>
            <FileText size={15} aria-hidden="true" />
            <span>{document.name}</span>
            <span className="mono muted">
              {document.content.length.toLocaleString()} chars
              {document.pageCount ? ` · ${document.pageCount} pp` : ''}
            </span>
          </summary>
          <label className="field">
            <span>Extracted / supplied source text</span>
            <textarea
              value={document.content}
              maxLength={maxChars}
              rows={8}
              disabled={disabled || Boolean(reading)}
              onChange={(event) =>
                changeDocuments(
                  documents.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, content: event.target.value } : item,
                  ),
                )
              }
            />
          </label>
          <button
            className="text-button danger-text"
            type="button"
            disabled={disabled || Boolean(reading)}
            onClick={() => changeDocuments(documents.filter((_, itemIndex) => itemIndex !== index))}
          >
            <Trash2 size={13} aria-hidden="true" /> Remove source
          </button>
        </details>
      ))}
      <details className="paste-source" open={documents.length === 0}>
        <summary>Or paste a source document</summary>
        <div className="field">
          <label htmlFor="paste-name">Source filename</label>
          <input
            id="paste-name"
            value={pasteName}
            maxLength={120}
            disabled={disabled}
            onChange={(event) => setPasteName(event.target.value)}
            placeholder="notes.txt"
          />
        </div>
        <div className="field">
          <label htmlFor="paste-content">
            Source text <span className="muted">(not your question)</span>
          </label>
          <textarea
            id="paste-content"
            rows={5}
            value={paste}
            maxLength={maxChars}
            disabled={disabled}
            onChange={(event) => setPaste(event.target.value)}
            placeholder="Paste 80 or more characters of source material…"
          />
        </div>
        <div className="section-heading">
          <small className="mono muted">
            {paste.length.toLocaleString()} / {maxChars.toLocaleString()}
          </small>
          <button
            className="button button-secondary button-small"
            type="button"
            disabled={
              disabled || Boolean(reading) || !paste.trim() || documents.length >= maxDocuments
            }
            onClick={addPaste}
          >
            <Plus size={14} aria-hidden="true" /> Attach pasted source
          </button>
        </div>
      </details>
      <small className="muted">
        Only extracted text is saved. Combined limit: {maxTotal.toLocaleString()} characters.
        Uploads stay on this server; model mode sends bounded context to your configured provider.
      </small>
    </section>
  );
}
