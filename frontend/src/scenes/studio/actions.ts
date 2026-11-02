import { useCallback, useMemo, useState } from 'react';
import type { StudioSectionView } from '../../../../shared/studio';
import { api, errorMessage } from '../../api';
import { useToast } from '../../design/ui';
import type { StudioHandle } from '../../hooks/useStudio';
import { saveBlob } from '../../lib/download';
import type { StudioDocument } from './model';

/** The steps of the review workflow that a person confirms. */
export type StepKind = 'submit' | 'approve' | 'request-changes' | 'reopen';

const STEP_DONE: Record<StepKind, { title: string; say: string }> = {
  submit: { title: 'Submitted for review', say: 'The report was submitted for review.' },
  approve: { title: 'Approved', say: 'The report was approved.' },
  'request-changes': {
    title: 'Sent back for changes',
    say: 'The report was sent back for changes.',
  },
  reopen: { title: 'Reopened', say: 'The report was reopened.' },
};

/** What a person can do to the document, each as one change the server confirms or refuses. */
export interface StudioActions {
  /** The name of the change in flight, so that exactly one control says it is working. */
  pending: string | null;
  exporting: boolean;
  edit: (section: StudioSectionView, body: string, reason: string | null) => Promise<boolean>;
  lock: (section: StudioSectionView, locked: boolean) => Promise<boolean>;
  note: (section: StudioSectionView, text: string) => Promise<boolean>;
  restore: (section: StudioSectionView, version: number) => Promise<boolean>;
  regenerate: (section: StudioSectionView, instruction: string | null) => Promise<boolean>;
  decide: (section: StudioSectionView, decision: 'accept' | 'reject') => Promise<boolean>;
  step: (kind: StepKind, note: string | null) => Promise<boolean>;
  start: (confirm: boolean, onConfirmRequired?: () => void) => Promise<boolean>;
  exportAs: (format: 'markdown' | 'json') => Promise<void>;
}

/**
 * Every change goes through `studio.act`, which lets one through at a time and, when the server says
 * the page was out of date, loads the document again. The version or revision each change names is the
 * one the person was looking at; the server refuses a change made on another, and never overwrites.
 */
export function useStudioActions({
  projectId,
  studio,
  document,
  say,
}: {
  projectId: string;
  studio: StudioHandle;
  document: StudioDocument | null;
  say: (message: string) => void;
}): StudioActions {
  const { act, pending } = studio;
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const revision = document?.revision ?? 0;

  const done = useCallback(
    (message: string) => (made: boolean) => {
      if (made) say(message);
      return made;
    },
    [say],
  );

  const exportAs = useCallback(
    async (format: 'markdown' | 'json') => {
      setExporting(true);
      try {
        saveBlob(
          await api.exportStudio(projectId, format),
          format === 'json' ? 'swarm-report-studio.json' : 'swarm-report-studio.md',
        );
        toast({
          title: format === 'json' ? 'JSON exported' : 'Markdown exported',
          tone: 'success',
          duration: 3200,
        });
        say(`Exported the report as ${format === 'json' ? 'JSON' : 'Markdown'}.`);
      } catch (failure) {
        toast({ title: 'The export failed', description: errorMessage(failure), tone: 'error' });
      } finally {
        setExporting(false);
      }
    },
    [projectId, say, toast],
  );

  return useMemo<StudioActions>(
    () => ({
      pending,
      exporting,
      edit: (section, body, reason) =>
        act(`edit:${section.id}`, () =>
          api.editSection(projectId, section.id, {
            body,
            expectedVersion: section.version,
            reason,
          }),
        ).then(done(`Saved a new version of ${section.title}.`)),
      lock: (section, locked) =>
        act(`lock:${section.id}`, () => api.lockSection(projectId, section.id, locked)).then(
          done(`${section.title} is ${locked ? 'locked' : 'unlocked'}.`),
        ),
      note: (section, text) =>
        act(`note:${section.id}`, () => api.addNote(projectId, section.id, text)).then(
          done(`Added a note to ${section.title}.`),
        ),
      restore: (section, version) =>
        act(`restore:${section.id}:${version}`, () =>
          api.restoreVersion(projectId, section.id, {
            version,
            expectedVersion: section.version,
            reason: null,
          }),
        ).then(done(`Restored version ${version} of ${section.title} as a new version.`)),
      regenerate: (section, instruction) =>
        act(`regenerate:${section.id}`, () =>
          api.regenerateSection(projectId, section.id, {
            expectedVersion: section.version,
            instruction,
          }),
        ).then(done(`The rewrite of ${section.title} is ready for your decision.`)),
      decide: (section, decision) =>
        act(`proposal:${section.id}:${decision}`, () =>
          api.decideProposal(projectId, section.id, {
            decision,
            proposalId: section.proposal?.id ?? '',
            expectedVersion: section.version,
          }),
        ).then(
          done(
            decision === 'accept'
              ? `Accepted the rewrite of ${section.title}.`
              : `Rejected the rewrite of ${section.title}.`,
          ),
        ),
      step: (kind, note) =>
        act(`step:${kind}`, () =>
          api.studioStep(projectId, kind, { expectedRevision: revision, note }),
        ).then((made) => {
          if (made) {
            say(STEP_DONE[kind].say);
            toast({ title: STEP_DONE[kind].title, tone: 'success', duration: 3600 });
          }
          return made;
        }),
      start: (confirm, onConfirmRequired) =>
        act('start', () => api.startStudio(projectId, confirm), {
          handled: (code) => {
            if (code !== 'CONFIRM_REQUIRED' || !onConfirmRequired) return false;
            onConfirmRequired();
            return true;
          },
        }).then(done('The report is open in the studio.')),
      exportAs,
    }),
    [act, done, exportAs, exporting, pending, projectId, revision, say, toast],
  );
}
