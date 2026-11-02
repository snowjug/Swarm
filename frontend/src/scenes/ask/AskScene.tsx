import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { Globe, Paperclip, Server, SlidersHorizontal, X } from 'lucide-react';
import { SCENARIO_QUESTION_MAX, type ScenarioFrame } from '../../../../shared/scenario';
import type {
  AppConfig,
  CreateProjectInput,
  ProjectDetail,
  ProjectSummary,
  ProviderConnectivity,
  SimulationSettings,
} from '../../../../shared/types';
import { errorMessage } from '../../api';
import { SwarmField } from '../../design/ambient';
import { SPRING } from '../../design/motion';
import { Button, ChipButton, Notice, Tooltip } from '../../design/ui';
import { useScenarioReading } from '../../hooks/useScenarioReading';
import { entryInput, validateEntry } from '../../lib/entryValidation';
import {
  canRead,
  documentSummaries,
  frameIssues,
  hasContext,
  tidyFrame,
  withContext,
  withEvidence,
  type Context,
} from '../../lib/intake';
import { POSITIONING_STATEMENT, urlIngestionEnabled } from '../../lib/product';
import type { UiMode } from '../../lib/mode';
import { Composer, Tray } from './Composer';
import { Assumptions, TimeFrame } from './Context';
import { DocumentSheet } from './DocumentSheet';
import { EvidenceMenu } from './EvidenceMenu';
import { JourneyPreview } from './JourneyPreview';
import { ReadingView } from './ReadingView';
import { Recents } from './Recents';
import { useRefocus } from './rows';
import { ScenarioReview } from './ScenarioReview';
import { SettingsPopover } from './SettingsPopover';
import {
  exampleLabel,
  OFFERED_EXAMPLES,
  startingFromExample,
  startingFromStarter,
  STARTER,
  type Starting,
} from './examples';
import { firstUrl, samePage, siteOf, type DocumentInput } from './evidence';
import { useEvidence } from './useEvidence';
import './AskScene.css';

export interface AskSceneProps {
  config: AppConfig | null;
  /** Live provider connectivity, so that the composer never contradicts the status chip. */
  connectivity?: ProviderConnectivity | null;
  /** A project whose question and evidence fill the composer ("duplicate"). */
  initialProject?: ProjectDetail;
  busy: boolean;
  onSubmit: (input: CreateProjectInput) => Promise<void>;
  history: { projects: ProjectSummary[] | null; loading: boolean; error: string | null };
  onOpenProject: (id: string) => void;
  onRetryHistory: () => void;
  onHistory: () => void;
  mode: UiMode;
}

type Phase = 'compose' | 'review';

const DEFAULT_SETTINGS: SimulationSettings = {
  mode: 'local',
  agentCount: 12,
  rounds: 8,
  seed: 42,
  network: 'community',
  intervention: null,
};

/** How long a reading may take before the screen says it is reading: quick ones just arrive. */
const NOTICEABLE_MS = 280;

/** From here the question says how much room is left: a person who pastes a long text should see where it was cut. */
const QUESTION_COUNT_FROM = 1700;

/** The keys that explore from the question box, as the device writes them (the code takes Ctrl or ⌘ on any device). */
const submitKeys = (): string =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/u.test(navigator.platform || '')
    ? '⌘ ↵'
    : 'Ctrl ↵';

const POOL = [...OFFERED_EXAMPLES.map((example) => example.question), STARTER.question];

/**
 * The first screen and the way into every exploration. One idea: say what change you want to explore.
 * The composer takes the question and the evidence; Swarm reads the question into a scenario you can
 * correct; going on starts the exploration with the evidence. Nothing runs before that.
 */
export function AskScene({
  config,
  connectivity = null,
  initialProject,
  busy,
  onSubmit,
  history,
  onOpenProject,
  onRetryHistory,
  onHistory,
}: AskSceneProps) {
  const [question, setQuestion] = useState(initialProject?.question ?? '');
  const [name, setName] = useState(
    initialProject ? `${initialProject.name.slice(0, 80)} (guided)` : '',
  );
  const [documents, setDocuments] = useState<DocumentInput[]>(
    () =>
      initialProject?.documents.map(({ name: documentName, content, pageCount, provenance }) => ({
        name: documentName,
        content,
        ...(pageCount ? { pageCount } : {}),
        ...(provenance ? { provenance } : {}),
      })) ?? [],
  );
  const [settings, setSettings] = useState<SimulationSettings>(
    initialProject?.settings ?? DEFAULT_SETTINGS,
  );
  const [frame, setFrame] = useState<ScenarioFrame | null>(null);
  // What the person said before the question was read: how long the effects are judged over, and what to take as given.
  const [horizon, setHorizon] = useState('');
  const [assumed, setAssumed] = useState<string[]>([]);
  const [read, setRead] = useState<{
    /** What the reading was made from: a different question, engine, source or context is a different reading. */
    key: string;
    mode: 'rules' | 'model';
    model: string | null;
    notes: string[];
  } | null>(null);
  const [phase, setPhase] = useState<Phase>('compose');
  const [loaded, setLoaded] = useState<Starting | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nudge, setNudge] = useState<{ target: 'question' | 'evidence'; key: number } | null>(null);
  const [focused, setFocused] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  // A page named in the question that the person asked to read: the evidence menu opens on it.
  const [pageRequest, setPageRequest] = useState<string | null>(null);
  const [openDocument, setOpenDocument] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [slow, setSlow] = useState(false);

  const form = useRef<HTMLFormElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const evidenceTrigger = useRef<HTMLButtonElement>(null);
  const addEvidenceTrigger = useRef<HTMLButtonElement>(null);
  const removedAt = useRef(0);
  // Going back to the question: the question is not on the page until the review has gone, so focus is asked for
  // here and given when the question arrives.
  const wantsQuestion = useRef(false);
  const questionArrived = useCallback((node: HTMLTextAreaElement | null) => {
    textarea.current = node;
    if (node && wantsQuestion.current) {
      wantsQuestion.current = false;
      node.focus({ preventScroll: true });
    }
  }, []);
  // A reading that failed: the way to read it again takes focus when the notice arrives, since the button that was
  // pressed has gone with the composer and focus would otherwise be left on the page.
  const wantsRetry = useRef(false);
  const retryArrived = useCallback((node: HTMLButtonElement | null) => {
    if (node && wantsRetry.current) {
      wantsRetry.current = false;
      node.focus({ preventScroll: true });
    }
  }, []);
  const reading = useScenarioReading();

  const disabled = busy || starting || reading.reading;
  const evidence = useEvidence({
    config,
    documents,
    // A complaint that was about the sources ("add a source") is answered by changing them, and goes.
    onChange: (next) => {
      setDocuments(next);
      setError(null);
    },
    disabled: busy || starting,
  });
  const useModel = settings.mode === 'llm';

  // A source that is taken away takes focus with it: it goes to the source that is now in its place, or to the
  // control that adds one, so that a keyboard is not sent back to the top of the page.
  const afterRemoval = useRefocus(() => {
    const open = scene.current?.querySelectorAll<HTMLElement>(
      '.sw-tray__pill:not([inert]) .sw-tray__open',
    );
    const next =
      open && open.length > 0 ? open[Math.min(removedAt.current, open.length - 1)] : null;
    return next ?? addEvidenceTrigger.current ?? evidenceTrigger.current;
  });
  const takeAway = (index: number) => {
    removedAt.current = index;
    evidence.remove(index);
    afterRemoval();
  };

  // The question and the button that was pressed leave the page when the scenario comes: focus goes to the heading
  // of what replaces them, so that a keyboard is where the scenario is and a screen reader says what it is. What
  // replaces them is a new page, and it starts at its top (a person who had scrolled a little before pressing
  // Explore would otherwise find the scenario opened in the middle of its first lines).
  const shownPhase = useRef(phase);
  useEffect(() => {
    if (shownPhase.current === phase) return;
    shownPhase.current = phase;
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (phase === 'review') title.current?.focus({ preventScroll: true });
  }, [phase]);

  // A reading that takes long enough to notice is shown; one that does not never flashes. The screen that says it is
  // reading is a page of its own, and starts at the top as the scenario does.
  useEffect(() => {
    if (!reading.reading) {
      setSlow(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      setSlow(true);
      window.scrollTo({ top: 0, behavior: 'instant' });
    }, NOTICEABLE_MS);
    return () => clearTimeout(timer);
  }, [reading.reading]);

  const issues = useMemo(() => (frame ? frameIssues(frame) : []), [frame]);
  const asked = canRead(question);

  const poke = useCallback((target: 'question' | 'evidence') => {
    setNudge((old) => ({ target, key: (old?.key ?? 0) + 1 }));
  }, []);

  const choose = (starting_: Starting) => {
    setName(starting_.name);
    setQuestion(starting_.question);
    setDocuments(starting_.documents);
    setHorizon('');
    setAssumed([]);
    setFrame(null);
    setRead(null);
    setLoaded(starting_);
    setError(null);
    reading.clearError();
    setPhase('compose');
    // With a finger on a phone the keyboard would open over what the example has just brought.
    if (!window.matchMedia('(pointer: coarse)').matches) {
      requestAnimationFrame(() => textarea.current?.focus());
    }
  };

  const explore = async () => {
    if (disabled) return;
    setError(null);
    reading.clearError();
    if (!asked) {
      setError('Say a little more: a sentence is enough.');
      poke('question');
      textarea.current?.focus();
      return;
    }
    if (documents.length === 0) {
      setError('Add a source to ground it: a file, pasted notes or a public page.');
      poke('evidence');
      setEvidenceOpen(true);
      return;
    }
    const context: Context = { horizon, assumptions: assumed };
    // What a reading is made from: the question, who reads it, what each source tells the reader of itself, and what
    // the person said. A reading whose sources have changed since is a different reading, and is made again; one
    // whose inputs are all as they were stays, with the person's own corrections of it.
    const sources = documentSummaries(documents);
    const key = JSON.stringify([question.trim(), useModel, sources, horizon.trim(), assumed]);
    if (frame && read && read.key === key) {
      setPhase('review');
      return;
    }
    wantsRetry.current = true;
    const result = await reading.read(question.trim(), sources, useModel);
    if (!result) return;
    wantsRetry.current = false;
    setFrame(withContext(result.frame, context));
    setRead({ key, mode: result.mode, model: result.model, notes: result.notes });
    setPhase('review');
  };

  const start = async (withFrame: ScenarioFrame | null) => {
    const parsed = validateEntry(
      entryInput({
        name,
        question,
        documents,
        settings,
        frame: withFrame ? tidyFrame(withEvidence(withFrame, documents)) : null,
      }),
    );
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setStarting(true);
    try {
      await onSubmit(parsed.data!);
    } catch (failure) {
      setError(errorMessage(failure));
      setStarting(false);
    }
  };

  // Only one thing in the page is the page's heading, and it changes with the phase.
  const heading = phase === 'review' ? 'Your scenario' : 'Explore what could happen next.';
  const missingSource = asked && documents.length === 0;

  const evidenceButton = (
    <Button
      ref={evidenceTrigger}
      variant="ghost"
      size="sm"
      icon={<Paperclip size={16} aria-hidden="true" />}
      className={nudge?.target === 'evidence' ? 'sw-nudge' : undefined}
      key={nudge?.target === 'evidence' ? `evidence-${nudge.key}` : 'evidence'}
    >
      Evidence
      {documents.length > 0 && (
        <>
          {' '}
          <span key={documents.length} className="sw-ask__badge sw-ask__badge--pop num">
            {documents.length}
          </span>{' '}
          <span className="sr-only">attached</span>
        </>
      )}
    </Button>
  );
  const evidenceMenu = (
    <EvidenceMenu
      evidence={evidence}
      urlEnabled={urlIngestionEnabled(config)}
      disabled={busy || starting}
      open={evidenceOpen}
      onOpenChange={(open) => {
        setEvidenceOpen(open);
        if (!open) setPageRequest(null);
      }}
      page={pageRequest}
      trigger={evidenceButton}
    />
  );
  // A page the question names, which has not been read as evidence yet, is offered as a source.
  const linked = urlIngestionEnabled(config) ? firstUrl(question) : null;
  const linkedRead = linked !== null && documents.some((document) => samePage(document, linked));

  return (
    <div
      className="sw-ask"
      data-phase={phase}
      data-composed={question.trim() !== '' || documents.length > 0 ? '' : undefined}
      ref={scene}
    >
      <AnimatePresence>
        {phase === 'compose' && !slow && (
          <m.div
            key="field"
            className="sw-ask__field"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            <SwarmField gather={focused || question.trim().length > 0} anchor={form} />
          </m.div>
        )}
      </AnimatePresence>
      <h1
        ref={title}
        tabIndex={-1}
        className={phase === 'review' || slow ? 'sr-only' : 'sw-ask__title sw-hero'}
      >
        {phase === 'review' || slow ? (
          heading
        ) : (
          <>
            Explore what could <em>happen</em> next.
          </>
        )}
      </h1>

      <AnimatePresence mode="wait" initial={false}>
        {slow ? (
          <m.div
            key="reading"
            className="sw-ask__stage"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <ReadingView
              question={question.trim()}
              model={useModel}
              onCancel={() => {
                wantsQuestion.current = true;
                wantsRetry.current = false;
                reading.cancel();
              }}
            />
          </m.div>
        ) : phase === 'compose' ? (
          <m.div
            key="compose"
            className="sw-ask__stage"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0, transition: SPRING.gentle }}
            exit={{ opacity: 0, y: -14, transition: { duration: 0.16 } }}
          >
            <p className="sw-ask__lead sw-lead sw-rise" style={{ '--i': 1 } as React.CSSProperties}>
              What change do you want to explore?
            </p>

            <div className="sw-ask__composer sw-rise" style={{ '--i': 2 } as React.CSSProperties}>
              <Composer
                ref={form}
                textareaRef={questionArrived}
                question={question}
                onQuestion={(value) => {
                  setQuestion(value);
                  setError(null);
                }}
                disabled={disabled}
                busy={reading.reading || starting}
                invalid={Boolean(error) && !asked}
                pool={POOL}
                describedBy="sw-ask-status"
                dropping={dropping}
                onDropState={setDropping}
                onDropFiles={(files) => void evidence.addFiles(files)}
                onFocusChange={setFocused}
                onSubmit={() => void explore()}
                tray={
                  <Tray
                    documents={documents}
                    disabled={busy || starting}
                    onOpen={setOpenDocument}
                    onRemove={takeAway}
                  />
                }
                suggestion={
                  linked && !linkedRead && !disabled ? (
                    <m.div
                      key="link"
                      className="sw-composer__suggest"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0, transition: SPRING.snappy }}
                      exit={{ opacity: 0, transition: { duration: 0.12 } }}
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Globe size={14} aria-hidden="true" />}
                        onClick={() => {
                          setPageRequest(linked);
                          setEvidenceOpen(true);
                        }}
                      >
                        Read {siteOf(linked)} as evidence
                      </Button>
                    </m.div>
                  ) : null
                }
                tools={
                  <>
                    {evidenceMenu}
                    <TimeFrame value={horizon} onChange={setHorizon} disabled={busy || starting} />
                    <Assumptions
                      items={assumed}
                      onChange={setAssumed}
                      disabled={busy || starting}
                    />
                    <SettingsPopover
                      config={config}
                      connectivity={connectivity}
                      settings={settings}
                      onSettings={setSettings}
                      name={name}
                      onName={setName}
                      disabled={busy || starting}
                      trigger={
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<SlidersHorizontal size={16} aria-hidden="true" />}
                          aria-label="Options"
                        >
                          <span className="sw-hide-sm">Options</span>
                        </Button>
                      }
                    />
                  </>
                }
                note={
                  <>
                    {useModel && (
                      <span className="sw-ask__engine">
                        <Server size={14} aria-hidden="true" />
                        Model assisted
                      </span>
                    )}
                    {question.length >= QUESTION_COUNT_FROM ? (
                      <>
                        <span
                          className={`sw-ask__count num${question.length >= SCENARIO_QUESTION_MAX ? ' is-full' : ''}`}
                          aria-hidden="true"
                        >
                          {question.length.toLocaleString('en-GB')} /{' '}
                          {SCENARIO_QUESTION_MAX.toLocaleString('en-GB')}
                        </span>
                        {question.length >= SCENARIO_QUESTION_MAX && (
                          <span className="sr-only" role="status">
                            The question is at its limit of{' '}
                            {SCENARIO_QUESTION_MAX.toLocaleString('en-GB')} characters.
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="sw-ask__hint sw-hide-sm" aria-hidden="true">
                        {missingSource ? (
                          'Add a source'
                        ) : (
                          <kbd className="sw-kbd">{submitKeys()}</kbd>
                        )}
                      </span>
                    )}
                  </>
                }
              />
              <div id="sw-ask-status" className="sw-ask__status" aria-live="polite">
                {(error || reading.error) && (
                  <Notice
                    tone={reading.error ? 'error' : 'caution'}
                    title={reading.error ? 'The question could not be read' : undefined}
                    action={
                      reading.error ? (
                        <span className="sw-ask__actions">
                          <Button
                            ref={retryArrived}
                            size="sm"
                            variant="glass"
                            onClick={() => void explore()}
                          >
                            Try again
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void start(null)}>
                            Continue without reading
                          </Button>
                        </span>
                      ) : undefined
                    }
                  >
                    {reading.error ?? error}
                    {reading.error && hasContext({ horizon, assumptions: assumed })
                      ? ' Without a reading, the time frame and assumptions you gave are not kept.'
                      : ''}
                  </Notice>
                )}
              </div>
            </div>

            {loaded ? (
              <div className="sw-ask__loaded sw-rise">
                <ChipButton
                  tone="accent"
                  wrap
                  pressed
                  onClick={() => setLoaded(null)}
                  aria-label={`${loaded.title} · ${loaded.summary}, loaded. Dismiss this note`}
                >
                  <span>
                    {loaded.title} · {loaded.summary}
                  </span>
                  <X size={13} aria-hidden="true" />
                </ChipButton>
              </div>
            ) : (
              <ul
                className="sw-ask__starts sw-rise"
                style={{ '--i': 3 } as React.CSSProperties}
                aria-label="Start from an example"
              >
                {OFFERED_EXAMPLES.map((example) => (
                  <li key={example.id}>
                    <Tooltip label={example.blurb}>
                      <button
                        type="button"
                        className="sw-ask__start"
                        disabled={disabled}
                        onClick={() => choose(startingFromExample(example))}
                      >
                        {exampleLabel(example)}
                      </button>
                    </Tooltip>
                  </li>
                ))}
                <li>
                  <Tooltip label={STARTER.blurb}>
                    <button
                      type="button"
                      className="sw-ask__start sw-ask__start--quiet"
                      disabled={disabled}
                      onClick={() => choose(startingFromStarter())}
                    >
                      {STARTER.label}
                    </button>
                  </Tooltip>
                </li>
              </ul>
            )}

            <p
              className="sw-ask__statement sw-caption sw-rise"
              style={{ '--i': 4 } as React.CSSProperties}
            >
              {POSITIONING_STATEMENT}
            </p>
            {initialProject && (
              <p className="sw-ask__copied sw-caption">
                Only the question, evidence and settings were copied. Nothing that was run.
              </p>
            )}

            <JourneyPreview />
          </m.div>
        ) : (
          frame && (
            <m.div
              key="review"
              className="sw-ask__stage sw-ask__stage--review"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0, transition: SPRING.gentle }}
              exit={{ opacity: 0, y: -10, transition: { duration: 0.14 } }}
            >
              <blockquote className="sw-ask__echo">{question.trim()}</blockquote>
              <ScenarioReview
                frame={frame}
                onFrame={setFrame}
                readMode={read?.mode ?? null}
                model={read?.model ?? null}
                notes={read?.notes ?? []}
                issues={issues}
                error={error}
                continuing={starting}
                onBack={() => {
                  wantsQuestion.current = true;
                  setPhase('compose');
                }}
                onContinue={() => void start(frame)}
                evidence={
                  <div className="sw-ask__evidence">
                    <Tray
                      documents={documents}
                      disabled={starting}
                      onOpen={setOpenDocument}
                      onRemove={takeAway}
                    />
                    <EvidenceMenu
                      evidence={evidence}
                      urlEnabled={urlIngestionEnabled(config)}
                      disabled={starting}
                      trigger={
                        <Button
                          ref={addEvidenceTrigger}
                          variant="ghost"
                          size="sm"
                          icon={<Paperclip size={14} aria-hidden="true" />}
                        >
                          Add evidence
                        </Button>
                      }
                    />
                  </div>
                }
              />
            </m.div>
          )
        )}
      </AnimatePresence>

      {phase === 'compose' && !slow && (
        <div className="sw-ask__recents">
          <Recents
            projects={history.projects}
            loading={history.loading}
            error={history.error}
            busy={busy}
            onOpen={onOpenProject}
            onRetry={onRetryHistory}
            onHistory={onHistory}
          />
        </div>
      )}

      <DocumentSheet
        document={openDocument === null ? null : (documents[openDocument] ?? null)}
        maxChars={evidence.limits.maxChars}
        disabled={starting}
        onChange={(content) => openDocument !== null && evidence.update(openDocument, content)}
        onRemove={() => {
          if (openDocument !== null) takeAway(openDocument);
          setOpenDocument(null);
        }}
        onClose={() => setOpenDocument(null)}
      />
    </div>
  );
}
