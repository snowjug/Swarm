import { Download } from 'lucide-react';
import { Notice } from '../ui';

export function JsonSnapshotExportButton({
  pending,
  onExport,
}: {
  pending: boolean;
  onExport: () => Promise<void>;
}) {
  return (
    <button
      className="button button-secondary button-small"
      type="button"
      disabled={pending}
      aria-busy={pending}
      title="Download the last persisted project snapshot, including saved in-progress data."
      onClick={(event) => {
        if (event.detail > 1) return;
        void onExport();
      }}
    >
      <Download size={14} aria-hidden="true" /> Export JSON
    </button>
  );
}

export function JsonSnapshotExportError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <Notice tone="error" title="JSON export failed">
      {error} You can retry Export JSON; the rest of the console remains available.
    </Notice>
  );
}
