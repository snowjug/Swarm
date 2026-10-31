import type { SourceProvenance } from '../../../shared/scenario';
import { jsonBody, request } from '../api';

/** A page the server fetched, as a document that can be one of a project's. */
export interface UrlEvidenceResult {
  document: { name: string; content: string; provenance: SourceProvenance };
  /** What a person should know about the page before relying on it. */
  notes: string[];
}

/** A CSV or JSON file the server read as text. */
export interface DataFileResult {
  name: string;
  content: string;
  bytes: number;
  notes: string[];
}

export const evidenceApi = {
  /** The server fetches the page: the browser never does. */
  fetchUrl: (url: string, signal?: AbortSignal) =>
    request<UrlEvidenceResult>('/api/evidence/url', { ...jsonBody({ url }), signal }),
  extractDataFile: (name: string, data: string, signal?: AbortSignal) =>
    request<DataFileResult>('/api/documents/extract', { ...jsonBody({ name, data }), signal }),
};
