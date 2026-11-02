import { useEffect, useState } from 'react';
import { ExternalLink, GitCompare, Undo2 } from 'lucide-react';
import { useWorkspace } from '../../../app/context';
import { api, errorMessage } from '../../../api';
import { Button, Disclosure, Notice } from '../../../design/ui';
import { describeChange } from '../../../lib/whatIf';
import { LINEAGE_NOTE } from './copy';
import { useDeep } from './context';
import { SectionHead } from './parts';
import { useOpenRuns, type RunsReach } from './reach';
import './lineage.css';

type Availability =
  { state: 'idle' | 'loading' | 'available' } | { state: 'unavailable'; message: string };

/**
 * Whether the parent run can still be opened. The history the shell already holds answers it where it can;
 * otherwise the parent is asked for, once, and again on request.
 */
function useParent(parentId: string | undefined, known: boolean) {
  const [state, setState] = useState<Availability>({ state: 'idle' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!parentId) return undefined;
    if (known) {
      setState({ state: 'available' });
      return undefined;
    }
    const controller = new AbortController();
    setState({ state: 'loading' });
    void api.project(parentId, controller.signal).then(
      () => !controller.signal.aborted && setState({ state: 'available' }),
      (failure: unknown) => {
        if (!controller.signal.aborted)
          setState({ state: 'unavailable', message: errorMessage(failure) });
      },
    );
    return () => controller.abort();
  }, [parentId, known, attempt]);
  return { state, retry: () => setAttempt((count) => count + 1) };
}

/** Where a branch came from: its parent, the round it left at, and every change that was declared. */
export function Lineage({ reach }: { reach: RunsReach }) {
  const { project, whatIf } = useDeep();
  const ws = useWorkspace();
  const openRuns = useOpenRuns(reach);
  const branch = project.console?.branch ?? null;
  const parent = useParent(
    branch?.parentId,
    Boolean(branch && ws.projects.some((item) => item.id === branch.parentId)),
  );
  if (!branch) return null;
  const copied =
    branch.fromRound > 0
      ? `Rounds 1 to ${branch.fromRound} were copied unchanged.`
      : 'No rounds were copied; this branch starts from scratch.';
  return (
    <section className="sw-deep-sec sw-deep-lineage" aria-labelledby="deep-lineage">
      <SectionHead
        id="deep-lineage"
        title={
          <>
            A branch of <em>{branch.parentName}</em>
          </>
        }
        lead={`Left after round ${branch.fromRound}. ${copied} ${LINEAGE_NOTE}`}
      />
      {branch.changes.length > 0 ? (
        <Disclosure
          summary={`${branch.changes.length} declared ${branch.changes.length === 1 ? 'change' : 'changes'}`}
          defaultOpen
        >
          <ul className="sw-deep-lineage__changes" role="list">
            {branch.changes.map((change, index) => (
              <li key={index}>{describeChange(change, project)}</li>
            ))}
          </ul>
        </Disclosure>
      ) : (
        <p className="sw-deep-fine">
          No assumption changes were recorded when the branch was made.
        </p>
      )}
      <div className="sw-deep-lineage__actions">
        {parent.state.state === 'available' ? (
          <Button
            variant="glass"
            icon={<Undo2 size={15} aria-hidden="true" />}
            onClick={() => ws.openProject(branch.parentId, { scene: 'simulate', view: 'deep' })}
          >
            Open the parent run
          </Button>
        ) : parent.state.state === 'unavailable' ? null : (
          <span className="sw-deep-fine">Checking that the parent is still there…</span>
        )}
        {whatIf && parent.state.state === 'available' && project.rounds.length > 0 && openRuns && (
          <Button
            variant="ghost"
            icon={<GitCompare size={15} aria-hidden="true" />}
            iconEnd={<ExternalLink size={13} aria-hidden="true" />}
            onClick={openRuns}
          >
            Compare with the parent
          </Button>
        )}
        {whatIf &&
          parent.state.state === 'available' &&
          project.rounds.length > 0 &&
          reach.way === 'closed' && (
            <span className="sw-deep-fine">
              Comparing the two runs opens once the scenarios have been compared.
            </span>
          )}
      </div>
      {parent.state.state === 'unavailable' && (
        <Notice
          tone="caution"
          title="The parent run cannot be opened"
          action={
            <Button size="sm" variant="glass" onClick={parent.retry}>
              Try again
            </Button>
          }
        >
          {parent.state.message} This branch and its declared changes remain readable.
        </Notice>
      )}
    </section>
  );
}
