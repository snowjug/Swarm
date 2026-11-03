import { ClipboardPaste, RotateCw } from 'lucide-react';
import { useMemo } from 'react';
import type { ResearchRun } from '../../../../../shared/research';
import { useWorkspace } from '../../../app/context';
import { Button, Notice, Skeleton } from '../../../design/ui';
import { isLive } from '../../../lib/research';
import { useGroundActions, useGroundData } from '../context';
import { plural } from '../model';
import { SectionHead } from '../SectionHead';
import { AddSource } from './AddSource';
import { Limits } from './Limits';
import { Pages, type PageActions } from './Pages';
import { Plan } from './Plan';
import { Stages } from './Stages';
import { Suggestions } from './Suggestions';
import { useGroundResearch, type GroundResearch } from './context';
import {
  agedBy,
  conflictsKnown,
  formatMoment,
  formatSeconds,
  runNotice,
  statusWords,
  stoppedWords,
  type Age,
} from './model';
import './research.css';

/** Where a person who has no source but the ones they could bring is sent: the question, with room to add them. */
function Manual() {
  const { duplicate, busy } = useWorkspace();
  return (
    <div className="sw-research-manual">
      <h3 className="sw-research-sub">Use sources of your own</h3>
      <p className="sw-research-quiet sw-caption">
        Open the question again to paste text, attach files or add pages. Swarm reads what you give
        it, and your question comes with you.
      </p>
      <Button
        variant="glass"
        size="sm"
        icon={<ClipboardPaste size={15} aria-hidden="true" />}
        disabled={busy}
        onClick={duplicate}
      >
        Open the question to add sources
      </Button>
    </div>
  );
}

/** What the run is doing now, in the words it last said, or when it ended and why. */
function RunLine({ run }: { run: ResearchRun }) {
  if (isLive(run.status)) {
    const last = run.events.at(-1);
    return (
      <p className="sw-research__line">
        <span className="num">{formatSeconds(run.used.elapsedMs)}</span>
        {last && <span className="sw-research__event">{last.message}</span>}
      </p>
    );
  }
  const why = stoppedWords(run);
  return (
    <p className="sw-research__line">
      <span>
        {run.status === 'completed' ? 'Finished' : 'Ended'}{' '}
        {formatMoment(run.finishedAt ?? run.updatedAt)} · took{' '}
        <span className="num">{formatSeconds(run.used.elapsedMs)}</span>
      </span>
      {why && <span className="sw-research__event">Why it stopped: {why}</span>}
    </p>
  );
}

function Conflicts({ run }: { run: ResearchRun }) {
  const data = useGroundData();
  const actions = useGroundActions();
  if (!conflictsKnown(run) || run.conflictCount === 0) return null;
  const linked = data.conflictsKnown;
  return (
    <p className="sw-research__conflicts">
      <span>
        {plural(run.conflictCount, 'possible conflict')} {run.conflictCount === 1 ? 'was' : 'were'}{' '}
        found among what was read.
      </span>
      {linked ? (
        <Button variant="ghost" size="sm" onClick={() => actions.goTo('conflicts')}>
          Review {run.conflictCount === 1 ? 'it' : 'them'}
        </Button>
      ) : (
        <span className="sw-caption">
          {run.conflictCount === 1 ? 'It is' : 'They are'} listed under Conflicts once the evidence
          is ready.
        </span>
      )}
    </p>
  );
}

function Body({ research, aged }: { research: GroundResearch; aged: Age | null }) {
  const { state, presence, takesOver, controls } = research;
  const data = useGroundData();
  const actions = useGroundActions();
  const pageActions = useMemo<PageActions>(
    () => ({
      openDocument: (id) => actions.openDocument(id),
      holds: (id) => data.documents.some((doc) => doc.id === id),
    }),
    [actions, data.documents],
  );

  if (presence.kind === 'loading') {
    return (
      <div className="sw-research-skeleton" aria-busy="true">
        <Skeleton height="1.6rem" />
        <Skeleton height="1.6rem" width="82%" />
        <Skeleton height="1.6rem" width="64%" />
      </div>
    );
  }
  if (presence.kind === 'unavailable') {
    return (
      <Notice
        tone="error"
        title="Research could not be read"
        action={
          <Button size="sm" variant="glass" onClick={state.reload}>
            Try again
          </Button>
        }
      >
        {presence.error}
      </Notice>
    );
  }
  if (presence.kind === 'empty') {
    const searches = presence.view.discovery.available;
    return (
      <>
        <p className="sw-research__lede">
          Swarm can research this question: plan what to look for, read public pages within set
          limits, and set what it finds beside what conflicts. You review the sources before
          anything is simulated.
        </p>
        <Stages run={null} />
        {!searches && (
          <Notice tone="info" title="Finding sources from a question alone is not set up here">
            {presence.view.discovery.message} Name a site or a page to start from, or use sources of
            your own.
          </Notice>
        )}
        <AddSource />
        {!searches && <Manual />}
      </>
    );
  }

  if (presence.kind === 'off') return null;
  const { run, view } = presence;
  const notice = runNotice(run, view.discovery);
  const manual = notice?.offers.includes('manual') ?? false;
  return (
    <>
      <RunLine run={run} />
      {state.error !== null && (
        <Notice
          tone="caution"
          title="Updates have paused"
          action={
            <Button size="sm" variant="glass" onClick={state.reload}>
              Try again
            </Button>
          }
        >
          Showing what was last read. {state.error}
        </Notice>
      )}
      {notice && (
        <Notice
          tone={notice.tone}
          title={notice.title}
          action={
            !takesOver && notice.offers.includes('again') && controls.start ? (
              <Button
                size="sm"
                variant="glass"
                icon={<RotateCw size={14} aria-hidden="true" />}
                disabled={state.working !== null}
                onClick={() => void state.start()}
              >
                {run.status === 'failed' ? 'Try again' : 'Research again'}
              </Button>
            ) : undefined
          }
        >
          {notice.body.map((line) => (
            <span key={line} className="sw-research__sentence">
              {line}
            </span>
          ))}
          {notice.quoted && <span className="sw-research__quoted">“{notice.quoted}”</span>}
        </Notice>
      )}
      {aged && (
        <Notice
          tone="caution"
          title="This research may be out of date"
          action={
            controls.start ? (
              <Button
                size="sm"
                variant="glass"
                icon={<RotateCw size={14} aria-hidden="true" />}
                disabled={state.working !== null}
                onClick={() => void state.start()}
              >
                Research again
              </Button>
            ) : undefined
          }
        >
          It finished {plural(aged.days, 'day')} ago, and the question was marked as{' '}
          {aged.sensitivity === 'fast-moving' ? 'one that moves quickly' : 'a recent one'}. Pages
          may have changed since.
        </Notice>
      )}
      <Stages run={run} />
      <Conflicts run={run} />
      <Pages sources={run.sources} actions={pageActions} status={run.status} />
      <Suggestions run={run} />
      <AddSource />
      {manual && <Manual />}
      <Plan run={run} />
      <Limits run={run} />
    </>
  );
}

/**
 * The research itself: where the run is among its six stages, every page it looked at and what became of each, what it
 * suggests, and the way to name a site or a page. Everything it says is what the run holds. It says where the run
 * is among them; it never says that a page is right.
 */
export function ResearchSection() {
  const research = useGroundResearch();
  const now = useMemo(() => Date.now(), []);
  if (!research || research.presence.kind === 'off') return null;
  const { state, presence, controls, takesOver } = research;
  const run = presence.kind === 'run' ? presence.run : null;
  const aged = run ? agedBy(run, now) : null;
  const words = statusWords(presence);
  const failed = state.problem && state.problem.kind !== 'add-source' ? state.problem : null;
  return (
    <section
      className="sw-ground__section sw-research"
      aria-labelledby="ground-research-title"
      data-research={presence.kind}
      data-status={run?.status}
    >
      <SectionHead
        id="ground-research"
        titleId="ground-research-title"
        title="Research"
        count={run && run.sources.length > 0 ? run.sources.length : null}
        aside={
          run && !takesOver && !aged && !isLive(run.status) && controls.start ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<RotateCw size={14} aria-hidden="true" />}
              disabled={state.working !== null}
              onClick={() => void state.start()}
            >
              Research again
            </Button>
          ) : null
        }
      />
      {run && words && (
        <p className="sr-only" role="status">
          Research: {words.label}.
        </p>
      )}
      {failed && (
        <Notice
          tone="error"
          title="That was not done"
          action={
            <Button size="sm" variant="glass" onClick={state.dismissProblem}>
              Dismiss
            </Button>
          }
        >
          {failed.message}
        </Notice>
      )}
      <Body research={research} aged={aged} />
    </section>
  );
}
