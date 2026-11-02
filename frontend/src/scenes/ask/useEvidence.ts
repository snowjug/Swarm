import { useCallback, useEffect, useRef, useState } from 'react';
import { documentInputSchema } from '../../../../shared/types';
import type { AppConfig } from '../../../../shared/types';
import { api, errorMessage } from '../../api';
import { evidenceApi } from '../../api/evidence';
import {
  base64,
  documentProblem,
  fileKind,
  fileProblem,
  limitsOf,
  nextPasteName,
  totalOf,
  withText,
  type DocumentInput,
} from './evidence';

export interface Evidence {
  documents: DocumentInput[];
  /** The name of the file being read, while one is. */
  reading: string | null;
  error: string | null;
  limits: ReturnType<typeof limitsOf>;
  total: number;
  full: boolean;
  addFiles: (files: FileList | readonly File[] | null) => Promise<void>;
  addPaste: (name: string, text: string) => boolean;
  addDocument: (document: DocumentInput) => void;
  update: (index: number, content: string) => void;
  remove: (index: number) => void;
  cancel: () => void;
  clearError: () => void;
  suggestedName: string;
  /** Whether this server reads PDFs: a kind that is not offered where it cannot be read. */
  pdf: boolean;
}

/**
 * The evidence a person attaches: files (read here, or by the server for a PDF, CSV or JSON), pasted text,
 * and pages the server fetched. A file that cannot be read is named with its reason and the others are kept;
 * stopping a read leaves what was already attached as it was. The caller owns the list.
 */
export function useEvidence({
  config,
  documents,
  onChange,
  disabled,
}: {
  config: AppConfig | null;
  documents: DocumentInput[];
  onChange: (documents: DocumentInput[]) => void;
  disabled: boolean;
}): Evidence {
  const [reading, setReading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const limits = limitsOf(config);
  const total = totalOf(documents);

  useEffect(() => () => controller.current?.abort(), []);

  const addFiles = useCallback<Evidence['addFiles']>(
    async (input) => {
      const files = input ? Array.from(input) : [];
      if (!files.length || reading || disabled) return;
      if (documents.length + files.length > limits.maxDocuments) {
        setError(`Use at most ${limits.maxDocuments} source documents. No files were added.`);
        return;
      }
      const request = new AbortController();
      controller.current = request;
      setError(null);
      const added: DocumentInput[] = [];
      const failures: string[] = [];
      try {
        for (const file of files) {
          if (request.signal.aborted) return;
          setReading(file.name);
          try {
            const problem = fileProblem(file, limits, Boolean(config?.capabilities.pdf));
            if (problem) throw new Error(problem);
            const kind = fileKind(file.name);
            const bytes = new Uint8Array(await file.arrayBuffer());
            if (request.signal.aborted) return;
            let document: DocumentInput;
            if (kind === 'table') {
              const read = await evidenceApi.extractDataFile(
                file.name,
                base64(bytes),
                request.signal,
              );
              document = { name: read.name, content: read.content };
            } else if (kind === 'pdf') {
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
                throw new Error(
                  'This file is not valid UTF-8 text. Save it as UTF-8 and try again.',
                );
              }
              document = { name: file.name, content };
            }
            const validated = documentInputSchema.safeParse(document);
            if (!validated.success) {
              throw new Error(documentProblem(validated.error.issues, limits));
            }
            const nextTotal = total + totalOf(added) + validated.data.content.length;
            if (nextTotal > limits.maxTotal) {
              throw new Error(
                `Combined source text exceeds ${limits.maxTotal.toLocaleString('en-GB')} characters.`,
              );
            }
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
        if (!request.signal.aborted) setReading(null);
      }
    },
    [config, disabled, documents, limits, onChange, reading, total],
  );

  const addPaste = useCallback<Evidence['addPaste']>(
    (name, text) => {
      const parsed = documentInputSchema.safeParse({ name, content: text });
      if (!parsed.success) {
        setError(documentProblem(parsed.error.issues, limits));
        return false;
      }
      if (
        documents.length >= limits.maxDocuments ||
        total + parsed.data.content.length > limits.maxTotal
      ) {
        setError(
          `Use at most ${limits.maxDocuments} documents and ${limits.maxTotal.toLocaleString('en-GB')} total characters.`,
        );
        return false;
      }
      onChange([...documents, parsed.data]);
      setError(null);
      return true;
    },
    [documents, limits, onChange, total],
  );

  const addDocument = useCallback<Evidence['addDocument']>(
    (document) => {
      onChange([...documents, document]);
      setError(null);
    },
    [documents, onChange],
  );

  const update = useCallback<Evidence['update']>(
    (index, content) => {
      setError(null);
      onChange(documents.map((item, at) => (at === index ? withText(item, content) : item)));
    },
    [documents, onChange],
  );

  const remove = useCallback<Evidence['remove']>(
    (index) => {
      setError(null);
      onChange(documents.filter((_, at) => at !== index));
    },
    [documents, onChange],
  );

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setReading(null);
    setError('Reading was stopped. Files already attached are unchanged.');
  }, []);

  return {
    documents,
    reading,
    error,
    limits,
    total,
    full: documents.length >= limits.maxDocuments,
    addFiles,
    addPaste,
    addDocument,
    update,
    remove,
    cancel,
    clearError: () => setError(null),
    suggestedName: nextPasteName(documents),
    pdf: Boolean(config?.capabilities.pdf),
  };
}
