import type { SourceProvenance } from '../../../../shared/scenario';

export interface UrlEvidenceProps {
  /** Called with a page the server fetched, ready to be one of the project's documents. */
  onAdd: (document: { name: string; content: string; provenance: SourceProvenance }) => void;
  disabled: boolean;
  /** How many more documents the project can take. */
  remainingDocuments: number;
}

/** Adds a public web page as evidence. Replaced by the URL-ingestion feature. */
export function UrlEvidence(_props: UrlEvidenceProps) {
  return null;
}
