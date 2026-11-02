import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  roomProblem,
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
  /** A page the server fetched. False, with the reason in `error`, when it does not fit among those attached. */
  addDocument: (document: DocumentInput) => boolean;
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

  // The list as it is now, not as it was when a call began: a file takes time to read, and what was attached in the
  // meantime (or by another call in the same moment) must not be written over when it is done.
  const latest = useRef(documents);
  useLayoutEffect(() => {
    latest.current = documents;
  }, [documents]);
  const commit = useCallback(
    (next: DocumentInput[]) => {
      latest.current = next;
      onChange(next);
    },
    [onChange],
  );

  useEffect(() => () => controller.current?.abort(), []);

  const addFiles = useCallback<Evidence['addFiles']>(
    async (input) => {
      const files = input ? Array.from(input) : [];
      if (!files.length || reading || disabled) return;
      if (latest.current.length + files.length > limits.maxDocuments) {
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
            const nextTotal =
              totalOf(latest.current) + totalOf(added) + validated.data.content.length;
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
          // They join what is attached now, as far as there is room for them.
          let attached = latest.current;
          for (const document of added) {
            const problem = roomProblem(attached, document.content.length, limits);
            if (problem) failures.push(`${document.name}: ${problem}`);
            else attached = [...attached, document];
          }
          if (attached !== latest.current) commit(attached);
          if (failures.length) setError(failures.join('\n'));
        }
      } finally {
        if (!request.signal.aborted) setReading(null);
      }
    },
    [commit, config, disabled, limits, reading],
  );

  const addPaste = useCallback<Evidence['addPaste']>(
    (name, text) => {
      const parsed = documentInputSchema.safeParse({ name, content: text });
      if (!parsed.success) {
        setError(documentProblem(parsed.error.issues, limits));
        return false;
      }
      const problem = roomProblem(latest.current, parsed.data.content.length, limits);
      if (problem) {
        setError(problem);
        return false;
      }
      commit([...latest.current, parsed.data]);
      setError(null);
      return true;
    },
    [commit, limits],
  );

  const addDocument = useCallback<Evidence['addDocument']>(
    (document) => {
      const problem = roomProblem(latest.current, document.content.length, limits);
      if (problem) {
        setError(problem);
        return false;
      }
      commit([...latest.current, document]);
      setError(null);
      return true;
    },
    [commit, limits],
  );

  const update = useCallback<Evidence['update']>(
    (index, content) => {
      setError(null);
      commit(latest.current.map((item, at) => (at === index ? withText(item, content) : item)));
    },
    [commit],
  );

  const remove = useCallback<Evidence['remove']>(
    (index) => {
      setError(null);
      commit(latest.current.filter((_, at) => at !== index));
    },
    [commit],
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
