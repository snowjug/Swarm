import { AnimatePresence, m } from 'motion/react';
import {
  ArrowRight,
  CircleCheck,
  CircleX,
  FlaskConical,
  PauseCircle,
  Sparkles,
  Square,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, Chip, Notice, Popover, PopoverContent, PopoverTrigger } from '../../design/ui';
import { SPRING, useReducedMotion } from '../../design/motion';
import type { Tone } from '../../design/ui';
import { useWorkspace } from '../../app/context';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { openConflicts } from '../../lib/ledger';
import { Figures, type FigureSpec } from './Figures';
import { Method } from './Method';
import { Phases } from './Phases';
import { SourceRows, type Reading } from './SourceRows';
import { RunActions } from './research/Controls';
import { useGroundResearch } from './research/context';
import { researchFigures } from './research/figures';
import { ResearchChip } from './research/ResearchChip';
import { statusWords } from './research/model';
import { useGroundActions, useGroundData } from './context';
import { vars } from './css';
import {
  elapsedSeconds,
  elapsedText,
  entityNoun,
  failureReason,
  isWorking,
  latestEvent,
  mayRun,
  MOMENT_LABEL,
  nextStep,
  plural,
  sampleNote,
  type GroundStage,
  type Moment,
} from './model';
import { useMoment } from './useMoment';
import { useNow } from './useNow';
import { subjectCoverage, subjectCoverageWords } from './subject';
import { ConstellationGraph } from './ConstellationGraph';

const STATUS: Record<Moment, { tone: Tone; dot?: boolean }> = {
  idle: { tone: 'neutral' },
  queued: { tone: 'accent', dot: true },
  reading: { tone: 'accent', dot: true },
  extracting: { tone: 'accent', dot: true },
  checking: { tone: 'accent', dot: true },
  ready: { tone: 'favor' },
  failed: { tone: 'critical' },
  stopped: { tone: 'caution' },
  record: { tone: 'neutral' },
};

function StatusChip({
  stage,
  moment,
  advanced,
  step,
}: {
  stage: GroundStage;
  moment: Moment;
  advanced: boolean;
  step: string | undefined;
}) {
  const status = STATUS[moment];
  const icon =
    moment === 'ready' ? (
      <CircleCheck aria-hidden="true" />
    ) : moment === 'failed' ? (
      <CircleX aria-hidden="true" />
    ) : moment === 'stopped' ? (
      <PauseCircle aria-hidden="true" />
    ) : undefined;
  return (
    <Chip
      tone={status.tone}
      dot={status.dot}
      icon={icon}
      size="sm"
      className="sw-ground__status"
      data-stage={stage}
      data-moment={moment}
    >
      {MOMENT_LABEL[moment]}
      {advanced && step ? <span className="sw-ground__engine">· Graph Build: {step}</span> : null}
    </Chip>
  );
}

function Question({ text }: { text: string }) {
  // On a phone the question keeps to three lines, so the figures and the action are not pushed off the first screen.
  const phone = useMediaQuery('(max-width: 40rem)');
  const long = text.length > (phone ? 96 : 170);
  return (
    <div className="sw-ground__ask">
      <h1 className="sw-ground__question" id="ground-question" data-long={long || undefined}>
        {text}
      </h1>
      {long && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="sw-ground__more">
              Read it all
            </Button>
          </PopoverTrigger>
          <PopoverContent width="24rem" align="start" aria-label="The question">
            <p className="sw-ground__full">{text}</p>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/** The first screen: what the evidence is, how much of it there is, whether anything disagrees, and what to do next. */
export function Hero() {
  const { project, busy, journey, go, run, cancel, mode } = useWorkspace();
  const data = useGroundData();
  const actions = useGroundActions();
  const reduced = useReducedMotion();
  const { stage, documents, passages, graph, ledger, conflictsKnown } = data;
  const working = isWorking(stage);
  const { moment, checking, phases } = useMoment();
  const now = useNow(working);
  const next = nextStep(journey);
  const noun = entityNoun(project.graph);
  const reason = failureReason(project);
  const event = latestEvent(project);
  const sample = sampleNote(documents);
  // While research is what the page is about, its status, its figures and its actions are the page's head, and its
  // stages are drawn where the research is; the evidence's own are what follow when research has done its part.
  const research = useGroundResearch();
  const takeover = research?.takesOver ? research : null;
  const researchWords = takeover ? statusWords(takeover.presence) : null;
  const researchOnly = takeover !== null && documents.length === 0;

  // A figure is a dash while the engine has not said, and a number once it has: a saved record that holds
  // no graph says none, since nothing more will arrive for it.
  const settled = stage === 'ready' || stage === 'record';
  // The sources may be about something near the question and not about it: say so, once they are read.
  const coverage = settled ? subjectCoverage(project.question, project.documents) : null;
  const subject = coverage ? subjectCoverageWords(coverage) : null;
  const all = conflictsKnown && ledger.ledger ? ledger.ledger.contradictions : null;
  const open = all ? openConflicts(all).length : settled && documents.length === 0 ? 0 : null;
  const conflictNote =
    all || open === 0
      ? all && all.length > 0
        ? open
          ? 'to review'
          : 'all reviewed'
        : 'none found'
      : undefined;
  const projectFigures: FigureSpec[] = [
    {
      id: 'sources',
      label: 'Sources',
      value: documents.length,
      tip: 'The documents it rests on',
      // Before there is a graph the sources are the whole of the first screen: there is nowhere to go.
      onPress: graph ? () => actions.goTo('sources') : null,
    },
    {
      id: 'passages',
      label: 'Passages',
      value: documents.length === 0 ? 0 : passages.index ? passages.index.all.length : null,
      tip: 'Numbered excerpts, S1 to Sn',
      onPress: documents.length > 0 ? () => actions.openBrowse() : null,
    },
    {
      id: 'entities',
      label: noun.many,
      value: graph ? graph.nodes.length : settled ? 0 : null,
      tip: graph ? 'What the sources talk about' : 'Known once the sources are read',
      onPress: graph ? () => actions.goTo('graph') : null,
    },
    {
      id: 'conflicts',
      label: 'Conflicts',
      value: open,
      note: conflictNote,
      tone: open ? 'caution' : undefined,
      // Whether it is loud is not known until the ledger is read; the page must not move when it is.
      reserve: conflictsKnown,
      tip: 'Sources that give different figures',
      onPress: all ? () => actions.goTo('conflicts') : null,
    },
  ];
  const figures = takeover
    ? researchFigures(takeover, all ? () => actions.goTo('conflicts') : null)
    : projectFigures;

  const startRun = () => void run('knowledge').catch(() => undefined);
  const stopRun = () => void cancel().catch(() => undefined);
  const reading: Reading =
    stage === 'running' ? 'active' : stage === 'ready' || stage === 'record' ? 'done' : 'idle';
  const startedAt = phases.find((phase) => phase.trace)?.trace?.startedAt ?? null;
  const elapsed = elapsedSeconds(latestEvent(project)?.at ?? null, now);

  let primary: ReactNode = null;
  if (stage === 'idle' && mayRun(project)) {
    primary = (
      <Button
        variant="accent"
        size="lg"
        icon={<Sparkles size={18} aria-hidden="true" />}
        busy={busy}
        onClick={startRun}
      >
        Ground it
      </Button>
    );
  } else if ((stage === 'failed' || stage === 'stopped') && mayRun(project)) {
    primary = (
      <Button variant="accent" size="lg" busy={busy} onClick={startRun}>
        {stage === 'failed' ? 'Try again' : 'Start again'}
      </Button>
    );
  } else if (working) {
    primary = (
      <Button
        variant="glass"
        size="lg"
        icon={<Square size={15} aria-hidden="true" />}
        busy={busy}
        onClick={stopRun}
      >
        Stop
      </Button>
    );
  } else if ((stage === 'ready' || stage === 'record') && next) {
    primary = (
      <Button
        variant="primary"
        size="lg"
        iconEnd={<ArrowRight size={18} aria-hidden="true" />}
        onClick={() => go(next.scene)}
      >
        {next.label}
      </Button>
    );
  }

  // Research is what the page is about: what to do is about the run, and the ones that are about the evidence wait.
  if (takeover) primary = <RunActions />;

  const status = takeover
    ? ''
    : stage === 'ready'
      ? `Ready. ${plural(documents.length, 'source')}${passages.index ? `, ${plural(passages.index.all.length, 'passage')}` : ''}${graph ? `, ${plural(graph.nodes.length, noun.one.toLowerCase(), noun.many.toLowerCase())}` : ''}.`
      : stage === 'running'
        ? moment === 'extracting'
          ? 'Extracting topics from the sources.'
          : 'Reading the sources.'
        : stage === 'queued'
          ? 'Waiting to start.'
          : stage === 'failed'
            ? 'Reading the sources failed.'
            : stage === 'stopped'
              ? 'Stopped before it finished.'
              : '';

  return (
    <section
      className="sw-ground__hero"
      aria-labelledby="ground-question"
      data-stage={stage}
      data-research={researchOnly ? 'only' : takeover ? 'live' : undefined}
    >
      <div className="sw-ground__lead">
        <div className="sw-ground__kicker sw-rise">
          <span className="sw-eyebrow">Ground</span>
          {researchWords ? (
            <ResearchChip words={researchWords} />
          ) : (
            <StatusChip
              stage={stage}
              moment={moment}
              advanced={mode === 'advanced'}
              step={project.console?.steps.knowledge}
            />
          )}
          {sample && (
            <span className="sw-ground__sample">
              <FlaskConical size={13} aria-hidden="true" />
              {sample}
            </span>
          )}
        </div>
        <div className="sw-ground__asking sw-rise" style={vars({ '--i': 1 })}>
          <Question text={project.question} />
        </div>

        <Figures items={figures} />

        {(working || checking) && !takeover && (
          <div className="sw-ground__progress">
            <Phases
              phases={phases}
              stage={stage}
              mode={mode}
              now={now}
              startedAt={startedAt}
              checking={checking}
            />
            {mode === 'advanced' && event && (
              <p className="sw-ground__event sw-caption">
                {event.message}
                {elapsed !== null ? ` · ${elapsedText(elapsed)}` : ''}
              </p>
            )}
          </div>
        )}

        {settled && !takeover && subject && (
          <Notice tone="caution" title={subject.title}>
            {subject.body}
          </Notice>
        )}

        {(stage === 'failed' || stage === 'stopped') && !takeover && (
          <m.div
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={SPRING.smooth}
          >
            <Notice
              tone={stage === 'failed' ? 'error' : 'caution'}
              title={
                stage === 'failed' ? 'Reading the sources failed' : 'Stopped before it finished'
              }
            >
              {stage === 'failed'
                ? (reason ?? 'The engine gave no reason.')
                : 'It did not finish. Start again when you are ready.'}
            </Notice>
          </m.div>
        )}

        <div className="sw-ground__actions sw-rise" style={vars({ '--i': 6 })} data-hero-action>
          {primary}
          {!researchOnly && (
            <Method
              graph={project.graph}
              ontology={project.console?.ontology ?? null}
              sampleEvidence={documents.some((doc) => doc.synthetic)}
              awaitingStatements={
                ledger.ledger !== null &&
                ledger.ledger.claims.length === 0 &&
                ledger.ledger.reviewedAt === null
              }
            />
          )}
        </div>
        <p className="sr-only" role="status">
          {status}
        </p>
      </div>

      {!researchOnly && (
        <div className="sw-ground__stage" aria-label="Evidence">
          <AnimatePresence mode="wait" initial={false}>
            {graph ? (
              <m.div
                key="graph"
                className="sw-ground__stage-in"
                initial={reduced ? false : { opacity: 0, scale: 0.985 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={SPRING.gentle}
              >
                <ConstellationGraph />
              </m.div>
            ) : (
              <m.div
                key="field"
                className="sw-ground__stage-in"
                initial={reduced ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <SourceRows variant="field" reading={reading} />
              </m.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}
