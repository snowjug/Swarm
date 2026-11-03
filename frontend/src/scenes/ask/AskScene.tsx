import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { Globe, Paperclip, Server, SlidersHorizontal, X } from 'lucide-react';
import { DEMO_PROJECTS } from '../../../../shared/demo';
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
import { Button, ChipButton, Notice } from '../../design/ui';
import { useScenarioReading } from '../../hooks/useScenarioReading';
import { entryInput } from '../../lib/entryValidation';
import {
  canRead,
  documentSummaries,
  frameIssues,
  hasContext,
  tidyFrame,
  withEvidence,
} from '../../lib/intake';
import { urlIngestionEnabled } from '../../lib/product';
import type { UiMode } from '../../lib/mode';
import { AdvancedPanel, AdvancedToggle, ResearchSwitch } from './Advanced';
import { capabilityFlags, constraintsEnabled, researchEnabled } from './capabilities';
import { Composer, Tray } from './Composer';
import { HorizonField, SiteField } from './ContextFields';
import { Assumptions } from './Context';
import { Credibility } from './Credibility';
import { Demonstrations } from './Demonstrations';
import { DocumentSheet } from './DocumentSheet';
import { EvidenceMenu } from './EvidenceMenu';
import { Explainer } from './Explainer';
import { flowSteps } from './flow';
import { Footer } from './Footer';
import { ReadingView } from './ReadingView';
import { Recents } from './Recents';
import {
  classifySite,
  horizonText,
  researchIntake,
  validateIntake,
  withIntake,
  type HorizonChoice,
  type Site,
} from './research';
import { useRefocus } from './rows';
import { ScenarioReview } from './ScenarioReview';
import { SettingsPopover } from './SettingsPopover';
import { Starts } from './Starts';
import { firstBlank, leftBlank, PROMPTS, type Template } from './templates';
import type { Starting } from './examples';
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

const POOL = PROMPTS;

/** What the website field adds to a sentence about research: nothing, a site, or one page. */
function startingFrom(site: Site): string {
  if (site.kind === 'domain') return `, starting from ${site.domain}`;
  if (site.kind === 'url') return `, starting from a page of ${site.host}`;
  return '';
}

/**
 * The first screen and the way into every exploration. One idea: say what change you want to explore.
 * The composer takes the question, what the person can say beside it, and whether Swarm researches for itself;
 * Swarm reads the question into a scenario you can correct; going on starts the exploration. Nothing runs before that.
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
  // What the person said beside the question before it was read: how long the effects are judged over, where, what to
  // take as given, and what research is asked to do.
  const [horizonChoice, setHorizonChoice] = useState<HorizonChoice>('open');
  const [horizonCustom, setHorizonCustom] = useState('');
  const [geography, setGeography] = useState('');
  const [assumed, setAssumed] = useState<string[]>([]);
  const [researchOn, setResearchOn] = useState(true);
  const [site, setSite] = useState('');
  const [siteSeen, setSiteSeen] = useState(false);
  const [guidance, setGuidance] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // The template whose blanks the question still has to fill, so that a question is not read with "[a team]" in it.
  const [template, setTemplate] = useState<string | null>(null);
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
  const siteInput = useRef<HTMLInputElement>(null);
  const geographyInput = useRef<HTMLInputElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const evidenceTrigger = useRef<HTMLButtonElement>(null);
  const addEvidenceTrigger = useRef<HTMLButtonElement>(null);
  const advancedId = useId();
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
  // Research is the server's to do: where it does not, the person's own sources are what a project is made from.
  const researchAvailable = researchEnabled(config);
  const researchRuns = researchAvailable && researchOn;
  const siteKind = useMemo(() => classifySite(site), [site]);
  const horizon = horizonText(horizonChoice, horizonCustom);

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

  /** Whether a finger is the pointer: it would have the keyboard open over what has just been put in the box. */
  const touching = () => window.matchMedia('(pointer: coarse)').matches;
  const focusQuestion = () => {
    if (!touching()) textarea.current?.focus();
  };

  // A sample case is a question with its own evidence: everything the person had said beside the question goes, as
  // it did for an example, and research is off, since the sources it brings are the point of it.
  const choose = (starting_: Starting) => {
    setName(starting_.name);
    setQuestion(starting_.question);
    setTemplate(null);
    setDocuments(starting_.documents);
    setHorizonChoice('open');
    setHorizonCustom('');
    setGeography('');
    setAssumed([]);
    setSite('');
    setSiteSeen(false);
    setGuidance('');
    setResearchOn(false);
    setFrame(null);
    setRead(null);
    setLoaded(starting_);
    setError(null);
    reading.clearError();
    setPhase('compose');
  };

  // A template only fills the box, and selects its first blank so that the next words replace it. It takes the place
  // of a sample case that was loaded, with the sources that came with that.
  const useTemplate = (chosen: Template) => {
    if (loaded) {
      setLoaded(null);
      setName('');
      setDocuments((old) => old.filter((document) => document.provenance?.kind !== 'sample'));
    }
    setQuestion(chosen.question);
    setTemplate(chosen.question);
    setError(null);
    reading.clearError();
    if (touching()) return;
    requestAnimationFrame(() => {
      const box = textarea.current;
      if (!box) return;
      box.focus();
      const blank = firstBlank(chosen.question);
      if (blank) box.setSelectionRange(blank[0], blank[1]);
    });
  };
  const startFromNothing = () => {
    if (template !== null && question === template) setQuestion('');
    setTemplate(null);
    focusQuestion();
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
    const blank = template === null ? null : leftBlank(question, template);
    if (blank) {
      setError(`Replace ${blank} with your own words.`);
      poke('question');
      const box = textarea.current;
      box?.focus();
      const at = box ? question.indexOf(blank) : -1;
      if (box && at >= 0) box.setSelectionRange(at, at + blank.length);
      return;
    }
    if (researchRuns && siteKind.kind === 'unclear') {
      setSiteSeen(true);
      siteInput.current?.focus();
      return;
    }
    if (documents.length === 0 && !researchRuns) {
      setError('Add a source to ground it: a file, pasted notes or a public page.');
      poke('evidence');
      setEvidenceOpen(true);
      return;
    }
    // What a reading is made from: the question, who reads it, what each source tells the reader of itself, and what
    // the person said. A reading whose sources have changed since is a different reading, and is made again; one
    // whose inputs are all as they were stays, with the person's own corrections of it.
    const sources = documentSummaries(documents);
    const key = JSON.stringify([
      question.trim(),
      useModel,
      sources,
      horizon.trim(),
      geography.trim(),
      assumed,
    ]);
    if (frame && read && read.key === key) {
      setPhase('review');
      return;
    }
    wantsRetry.current = true;
    const result = await reading.read(question.trim(), sources, useModel);
    if (!result) return;
    wantsRetry.current = false;
    setFrame(withIntake(result.frame, { horizon, geography, assumptions: assumed }));
    setRead({ key, mode: result.mode, model: result.model, notes: result.notes });
    setPhase('review');
  };

  const start = async (withFrame: ScenarioFrame | null) => {
    const parsed = validateIntake(
      {
        ...entryInput({
          name,
          question,
          documents,
          settings,
          frame: withFrame ? tidyFrame(withEvidence(withFrame, documents)) : null,
        }),
        research: researchIntake({
          auto: researchRuns,
          site: siteKind,
          horizon,
          geography,
          guidance,
        }),
      },
      { withoutSources: researchRuns },
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
  const heading = phase === 'review' ? 'Your scenario' : 'See how a decision could unfold.';
  const missingSource = asked && documents.length === 0 && !researchRuns;
  const advancedSet =
    (geography.trim() ? 1 : 0) + (guidance.trim() ? 1 : 0) + (assumed.length > 0 ? 1 : 0);
  const flags = capabilityFlags(config);
  const steps = useMemo(
    () => flowSteps({ research: researchRuns, constraints: constraintsEnabled(config) }),
    [researchRuns, config],
  );
  // The recorded demonstration is offered only when this workspace holds it.
  const recording =
    DEMO_PROJECTS.find(
      (demo) => demo.role === 'base' && history.projects?.some((project) => project.id === demo.id),
    ) ?? null;

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
      <div className="sw-ask-hero">
        <h1
          ref={title}
          tabIndex={-1}
          className={phase === 'review' || slow ? 'sr-only' : 'sw-ask__title sw-hero'}
        >
          {phase === 'review' || slow ? (
            heading
          ) : (
            <>
              See how a decision could <em>unfold</em>.
            </>
          )}
        </h1>
        {phase === 'compose' && !slow && (
          <p
            className="sw-ask-hero__lead sw-lead sw-rise"
            style={{ '--i': 1 } as React.CSSProperties}
          >
            Swarm researches the context, maps who matters, simulates reactions, and shows possible
            paths forward.
          </p>
        )}
      </div>

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
                context={
                  <>
                    <SiteField
                      ref={siteInput}
                      value={site}
                      site={siteKind}
                      onChange={(value) => {
                        setSite(value);
                        setSiteSeen(false);
                      }}
                      seen={siteSeen}
                      onSeen={() => setSiteSeen(true)}
                      disabled={busy || starting}
                      active={researchRuns}
                    />
                    <HorizonField
                      choice={horizonChoice}
                      custom={horizonCustom}
                      onChoice={setHorizonChoice}
                      onCustom={setHorizonCustom}
                      disabled={busy || starting}
                    />
                  </>
                }
                research={
                  <ResearchSwitch
                    available={researchAvailable}
                    on={researchOn}
                    onChange={setResearchOn}
                    disabled={busy || starting}
                  />
                }
                tools={
                  <>
                    {evidenceMenu}
                    <AdvancedToggle
                      open={advancedOpen}
                      onToggle={(keyboard) => {
                        setAdvancedOpen((open) => !open);
                        // The fields that open are after the button that was pressed, and the way forward comes
                        // between them in the page: a keyboard is taken into them, a pointer is not moved.
                        if (keyboard && !advancedOpen) {
                          requestAnimationFrame(() => geographyInput.current?.focus());
                        }
                      }}
                      controls={advancedId}
                      count={advancedSet}
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
                          title="Options"
                        />
                      }
                    />
                  </>
                }
                panel={
                  <AdvancedPanel
                    id={advancedId}
                    open={advancedOpen}
                    geography={geography}
                    geographyRef={geographyInput}
                    onGeography={setGeography}
                    guidance={guidance}
                    onGuidance={setGuidance}
                    researchOn={researchRuns}
                    disabled={busy || starting}
                    assumptions={
                      <Assumptions
                        items={assumed}
                        onChange={setAssumed}
                        disabled={busy || starting}
                      />
                    }
                  />
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
                    {reading.error &&
                    (hasContext({ horizon, assumptions: assumed }) || geography.trim())
                      ? ' Without a reading, the time frame, place and assumptions you gave are not kept.'
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
              <div className="sw-ask__block sw-rise" style={{ '--i': 3 } as React.CSSProperties}>
                <Starts disabled={disabled} onTemplate={useTemplate} onCustom={startFromNothing} />
              </div>
            )}

            <div className="sw-ask__block sw-rise" style={{ '--i': 4 } as React.CSSProperties}>
              <Explainer steps={steps} />
            </div>
            <div className="sw-ask__block sw-rise" style={{ '--i': 5 } as React.CSSProperties}>
              <Credibility flags={flags} />
            </div>
            <div className="sw-ask__block sw-rise" style={{ '--i': 6 } as React.CSSProperties}>
              <Footer
                demonstrations={
                  <Demonstrations
                    recording={recording}
                    disabled={disabled}
                    onRecording={() => recording && onOpenProject(recording.id)}
                    onSample={choose}
                    onFocusQuestion={focusQuestion}
                  />
                }
              />
            </div>
            {initialProject && (
              <p className="sw-ask__copied sw-caption">
                Only the question, evidence and settings were copied. Nothing that was run.
              </p>
            )}
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
                    {researchRuns && (
                      <p className="sw-ask__research sw-caption">
                        Automatic research is on. After you continue, Swarm looks for public sources
                        {startingFrom(siteKind)}, and lists every page it reads.
                      </p>
                    )}
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
