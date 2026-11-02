import {
  ArrowRight,
  FileText,
  GitBranch,
  GitCompare,
  Lock,
  MessageCircle,
  RotateCcw,
  Sparkles,
  Waves,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useWorkspace } from '../../../app/context';
import { Notice, Stat } from '../../../design/ui';
import { sceneAvailable } from '../../../app/scenes';
import { resumeActionLabel } from '../../../lib/whatIf';
import { PAUSE_HELP } from './copy';
import { useDeep } from './context';
import { Lineage } from './Lineage';
import {
  deepPhase,
  interventionMark,
  minutesText,
  phaseView,
  plural,
  roundsSentence,
  savedRounds,
  copiedRounds,
  waitingBranch,
} from './model';
import { SectionHead } from './parts';
import { Platforms } from './Platforms';
import { useRunsReach, useOpenRuns, type RunsReach } from './reach';
import { RoundTrack } from './RoundTrack';
import { Scheduled } from './Scheduled';
import { maxBranchRound } from '../../../lib/whatIf';
import './run.css';

/** What a pause or a stop has left behind, said once, in the words that matter: saved rounds stay, none is half saved. */
function Explain() {
  const { project, controls } = useDeep();
  const phase = deepPhase(project);
  const saved = project.rounds.length;
  if (phase === 'paused') {
    if (waitingBranch(project)) {
      return (
        <Notice
          tone="info"
          title={`Branched after round ${savedRounds(project)} of ${project.roundCount}`}
        >
          Rounds 1 to {savedRounds(project)} were copied from the parent and will not run again.{' '}
          {resumeActionLabel(project)} to run the rest with the declared changes below. A restart
          would discard the {plural(saved, 'copied round')}.
        </Notice>
      );
    }
    return (
      <Notice tone="info" title="Saved rounds are kept">
        They will not run again. {resumeActionLabel(project)}. A restart discards{' '}
        {plural(saved, 'saved round')}. The round that was in flight when you paused was discarded,
        never half saved.
      </Notice>
    );
  }
  if (controls.recovering) {
    return (
      <Notice tone="caution" title={`A saved checkpoint at round ${savedRounds(project)}`}>
        Saved rounds will not run again. {resumeActionLabel(project)}, or discard{' '}
        {plural(saved, 'saved round')} and start again from round 1.
      </Notice>
    );
  }
  if (phase === 'running' || phase === 'queued')
    return <p className="sw-deep-fine">{PAUSE_HELP}</p>;
  return null;
}

function Row({
  icon,
  title,
  text,
  onPress,
  tone,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  /** Null where it is not open yet: the row stays, says why, and does nothing. */
  onPress: (() => void) | null;
  tone?: 'danger';
}) {
  return (
    <li>
      <button
        type="button"
        className="sw-deep-act"
        data-tone={tone}
        aria-disabled={onPress === null || undefined}
        onClick={onPress ?? undefined}
      >
        <span className="sw-deep-act__icon" aria-hidden="true">
          {icon}
        </span>
        <span className="sw-deep-act__body">
          <span className="sw-deep-act__title">{title}</span>
          <span className="sw-deep-act__text">{text}</span>
        </span>
        {onPress ? (
          <ArrowRight className="sw-deep-act__go" size={17} aria-hidden="true" />
        ) : (
          <Lock className="sw-deep-act__go" size={16} aria-hidden="true" />
        )}
      </button>
    </li>
  );
}

/** What a person can do with the run next, as a short list: each is one press. */
function Next({ reach }: { reach: RunsReach }) {
  const { project, controls, actions, whatIf, round, setTab, openBranch, askRestart } = useDeep();
  const ws = useWorkspace();
  const openRuns = useOpenRuns(reach);
  const comparable =
    whatIf &&
    project.rounds.length > 0 &&
    (project.parentId !== null ||
      ws.projects.some(
        (item) => item.id !== project.id && item.workflow === 'guided' && item.currentRound > 0,
      ));
  const rows: ReactNode[] = [];
  if (project.rounds.length > 0) {
    rows.push(
      <Row
        key="rounds"
        icon={<Waves size={18} />}
        title="Look at the rounds"
        text="Scrub through each platform and see who moved, and what they did."
        onPress={() => setTab('rounds')}
      />,
    );
  }
  if (controls.branch) {
    rows.push(
      <Row
        key="branch"
        icon={<GitBranch size={18} />}
        title="Branch from a round"
        text="Try another assumption from a saved checkpoint. The source run is never changed."
        onPress={() => openBranch(Math.min(round, maxBranchRound(project)))}
      />,
    );
  }
  if (comparable && reach.way !== 'checking') {
    rows.push(
      <Row
        key="compare"
        icon={<GitCompare size={18} />}
        title="Compare two recorded runs"
        text={
          reach.way === 'closed'
            ? 'Opens once the scenarios have been compared. Run that from the simulation first.'
            : reach.way === 'parent'
              ? 'Lay this run beside the one it was branched from, round by round. Opens on that run.'
              : 'Lay this run beside its parent, a branch or another run, round by round.'
        }
        onPress={openRuns}
      />,
    );
  }
  if (controls.report === 'write') {
    rows.push(
      <Row
        key="report"
        icon={<Sparkles size={18} />}
        title="Write the detailed report"
        text="A report and an evidence trail for this run, separate from the decision brief."
        onPress={actions.report}
      />,
    );
  } else if (controls.report === 'open') {
    const open = sceneAvailable(project, 'decide');
    rows.push(
      <Row
        key="report"
        icon={<FileText size={18} />}
        title="Open the detailed report"
        text={
          open
            ? 'The report and evidence trail written for this run.'
            : 'It is written. It opens with the decision page, once the scenarios have been compared.'
        }
        onPress={open ? actions.openReport : null}
      />,
    );
  }
  if (project.agents.length > 0 && project.rounds.length > 0) {
    rows.push(
      <Row
        key="ask"
        icon={<MessageCircle size={18} />}
        title="Ask a proxy"
        text="Put a question to one proxy, or survey a few. They are fictional stand-ins."
        onPress={() => ws.panels.ask({ target: project.agents[0]?.id })}
      />,
    );
  }
  if (controls.restart) {
    rows.push(
      <Row
        key="restart"
        icon={<RotateCcw size={18} />}
        title={controls.recovering ? 'Retry from round 1' : 'Restart from round 1'}
        text={`Discards ${plural(project.rounds.length, 'saved round')} and starts again with the saved environment.`}
        tone="danger"
        onPress={askRestart}
      />,
    );
  }
  if (rows.length === 0) return null;
  return (
    <section className="sw-deep-sec" aria-labelledby="deep-next">
      <SectionHead id="deep-next" title="What you can do" />
      <ul className="sw-deep-acts" role="list">
        {rows}
      </ul>
    </section>
  );
}

/** The run: where it stands, the rounds on a line, the two platforms at the round chosen, the assumed event and what comes next. */
export function Run() {
  const { project, round, setRound, platforms } = useDeep();
  const phase = deepPhase(project);
  const view = phaseView(project);
  const saved = savedRounds(project);
  const total = project.roundCount;
  const minutes = project.console?.environment?.minutesPerRound ?? null;
  const mark = interventionMark(project);
  const copied = copiedRounds(project);
  const started = phase !== 'unprepared' && phase !== 'preparing' && phase !== 'prep-stopped';
  const proxies = project.agents.length;
  const planned = platforms.filter((item) => item.planned).length;
  const reach = useRunsReach(project);

  if (!started) return null;
  return (
    <div className="sw-deep-run">
      <div className="sw-deep-run__notes">
        {project.error && (
          <Notice tone="error" title="The server recorded an error">
            {project.error}
          </Notice>
        )}
        <Explain />
      </div>

      <section className="sw-deep-sec" aria-labelledby="deep-rounds-track">
        <SectionHead
          id="deep-rounds-track"
          title="The rounds"
          lead={roundsSentence(project, phase)}
        />
        <RoundTrack
          size="lg"
          label="Round in view"
          total={total}
          saved={saved}
          value={Math.min(round, saved)}
          onChange={setRound}
          inFlight={view.live && phase === 'running'}
          event={mark ? { round: mark.round, applied: mark.applied } : null}
          copied={copied}
          disabled={saved === 0}
          valueText={(value) =>
            value === 0
              ? 'The start, before round 1'
              : `Round ${value} of ${total}${minutes ? `, ${minutesText(value * minutes)} in` : ''}`
          }
        />
        <div className="sw-deep-facts" role="group" aria-label="The run in numbers">
          <Stat size="sm" label="Rounds saved" value={saved} caption={`of ${total}`} />
          <Stat size="sm" label="Proxies" value={proxies} caption="fictional" />
          <Stat
            size="sm"
            label="Scenario time"
            value={minutes ? minutesText(saved * minutes) : '—'}
            caption={minutes ? `of ${minutesText(total * minutes)}` : 'not recorded'}
          />
          <Stat size="sm" label="Platforms" value={planned} caption="kept apart" />
        </div>
        {copied > 0 && (
          <p className="sw-deep-fine">
            Rounds 1 to {copied} came from the parent run and were not run again.
          </p>
        )}
        {mark && (
          <p className="sw-deep-fine">
            The flag marks the assumed event: {mark.applied ? 'applied in' : 'scheduled before'}{' '}
            round {mark.round}.
          </p>
        )}
      </section>

      <Platforms />
      <Scheduled />
      <Lineage reach={reach} />
      <Next reach={reach} />
    </div>
  );
}
