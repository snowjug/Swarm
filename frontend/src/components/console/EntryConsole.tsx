import { useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowRight, CheckCircle2, Circle, History, Info, TriangleAlert } from 'lucide-react';
import { EXAMPLE_SCENARIOS, type ExampleScenario } from '../../../../shared/example-scenarios';
import type { ScenarioFrame } from '../../../../shared/scenario';
import { MAX_DOCUMENTS } from '../../../../shared/types';
import type {
  AppConfig,
  CreateProjectInput,
  ProjectDetail,
  ProviderConnectivity,
  SimulationSettings,
} from '../../../../shared/types';
import { errorMessage } from '../../api';
import { entryInput, validateEntry } from '../../lib/entryValidation';
import type { UiMode } from '../../lib/mode';
import { exampleEvidence, urlIngestionEnabled } from '../../lib/product';
import { authText, modelReadiness, realModelLabel } from '../../lib/provider';
import { ScenarioIntake } from '../intake/ScenarioIntake';
import { UrlEvidence } from '../evidence/UrlEvidence';
import { SourceInput } from './SourceInput';
import { DemoWorkspace, type DemoHistory } from './DemoWorkspace';
import { ExamplePicker } from './ExamplePicker';
import { LandingHero } from './LandingHero';
import { Notice, Spinner } from '../ui';

const explanations = [
  [
    'Graph Build',
    'Extract a cited graph and inspect its actual entity and relationship types. Local mode uses lexical topics and co-occurrence.',
  ],
  [
    'Environment Setup',
    'Prepare fictional proxies, then review and edit assumptions, seed inputs, platforms and timing.',
  ],
  [
    'Simulation',
    'Run the prepared environment. Inspect recorded actions and memory feedback, or cancel execution.',
  ],
  ['Report', 'Generate an evidence-linked report with its recorded plan and tool input/output.'],
  [
    'Interaction',
    'Question the report, inspect fictional proxies, or take a state snapshot / model interview survey.',
  ],
];

const starter = {
  name: 'Fictional library-hours scenario',
  question:
    'How might fictional community groups respond to a proposed change in library opening hours?',
  documents: [
    {
      name: 'fictional-library-input.md',
      content:
        '# Fictional starter input — not a real case\n\nA fictional town library is considering a pilot that extends evening opening hours on two weekdays while reducing Sunday hours. The draft proposal keeps the total weekly staffing budget unchanged. Students have asked for quiet evening study space. A fictional parent group values weekend access, while staff representatives have requested predictable shifts and a review of transport safety after closing. No survey has been conducted, no vote has occurred, and no outcome is known. The library proposes a six-week trial followed by an open feedback meeting. These statements are scenario assumptions supplied as input, not measured public opinion.',
      provenance: { kind: 'sample' as const },
    },
  ],
};

export function EntryConsole({
  config,
  connectivity = null,
  initialProject,
  busy,
  onSubmit,
  onHistory,
  demoHistory,
  onOpenProject,
  onRetryHistory,
  mode = 'guided',
  examples = EXAMPLE_SCENARIOS,
}: {
  config: AppConfig | null;
  /** Live provider connectivity from the header badge, so this card never contradicts it. */
  connectivity?: ProviderConnectivity | null;
  initialProject?: ProjectDetail;
  busy: boolean;
  onSubmit: (input: CreateProjectInput) => Promise<void>;
  onHistory: () => void;
  /** The saved projects, for the demonstration workspace. Without them it is not shown. */
  demoHistory?: DemoHistory;
  onOpenProject?: (id: string) => void;
  onRetryHistory?: () => void;
  /** Advanced opens the system details and the engine's stages; Guided keeps them one click away. */
  mode?: UiMode;
  /** Worked examples to start from. The list may be empty. */
  examples?: readonly ExampleScenario[];
}) {
  const [name, setName] = useState(
    initialProject ? `${initialProject.name.slice(0, 80)} (guided)` : '',
  );
  const [question, setQuestion] = useState(initialProject?.question ?? '');
  const [frame, setFrame] = useState<ScenarioFrame | null>(null);
  const [documents, setDocuments] = useState<CreateProjectInput['documents']>(
    initialProject?.documents.map(({ name, content, pageCount, provenance }) => ({
      name,
      content,
      ...(pageCount ? { pageCount } : {}),
      ...(provenance ? { provenance } : {}),
    })) ?? [],
  );
  const [settings, setSettings] = useState<SimulationSettings>(
    initialProject?.settings ?? {
      mode: 'local',
      agentCount: 12,
      rounds: 8,
      seed: 42,
      network: 'community',
      intervention: null,
    },
  );
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ title: string; evidence: string | null } | null>(null);
  const validationId = useId();
  const questionHelpId = useId();
  const clearFileError = useRef<(() => void) | null>(null);
  const questionField = useRef<HTMLTextAreaElement>(null);
  const modelAvailable = Boolean(config?.capabilities.modelAssisted && config.provider.configured);
  const maxAgents =
    settings.mode === 'llm'
      ? (config?.limits.modelMaxAgents ?? 10)
      : (config?.limits.localMaxAgents ?? 24);
  const maxRounds =
    settings.mode === 'llm'
      ? (config?.limits.modelMaxRounds ?? 10)
      : (config?.limits.localMaxRounds ?? 24);
  const maxDocuments = config?.limits.maxDocuments ?? MAX_DOCUMENTS;
  const disabled = busy || reading;
  const readiness = modelReadiness(modelAvailable, connectivity);

  // An example brings a question and evidence, and nothing else: the structure read from an earlier
  // question no longer fits, and the first thing to do is to read what was filled in.
  const fill = (next: {
    name: string;
    question: string;
    documents: CreateProjectInput['documents'];
    notice: { title: string; evidence: string | null };
  }) => {
    setName(next.name);
    setQuestion(next.question);
    setDocuments(next.documents);
    setFrame(null);
    setLoaded(next.notice);
    setError(null);
    questionField.current?.focus();
  };
  const chooseExample = (example: ExampleScenario) =>
    fill({
      name: example.title.slice(0, 100),
      question: example.question,
      documents: example.documents.map(({ name, content, provenance }) => ({
        name,
        content,
        provenance,
      })),
      notice: { title: example.title, evidence: exampleEvidence(example) },
    });
  const chooseStarter = () =>
    fill({
      name: starter.name,
      question: starter.question,
      documents: starter.documents,
      notice: { title: 'Fictional starter input', evidence: null },
    });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled) return;
    clearFileError.current?.();
    if (!config?.capabilities.guidedConsole) {
      setError(
        'The guided API is not ready. Reload server configuration before creating a project.',
      );
      return;
    }
    if (settings.mode === 'llm' && !modelAvailable) {
      setError(
        'Model assistance is not configured. Select local rules or configure a server-side provider.',
      );
      return;
    }
    const parsed = validateEntry(entryInput({ name, question, documents, settings, frame }));
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    setError(null);
    try {
      await onSubmit(parsed.data!);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const setMode = (mode: 'local' | 'llm') => {
    const limit = mode === 'llm' ? 10 : 24;
    setSettings((old) => ({
      ...old,
      mode,
      agentCount: Math.min(old.agentCount, limit),
      rounds: Math.min(old.rounds, limit),
      intervention: old.intervention && old.intervention.round <= limit ? old.intervention : null,
    }));
  };

  return (
    <div className="entry-console">
      <LandingHero />
      <div className="entry-main">
        <form
          className="entry-form card"
          noValidate
          onSubmit={(event) => void submit(event)}
          aria-busy={busy}
          aria-describedby={validationId}
          onChangeCapture={() => {
            setError(null);
            clearFileError.current?.();
          }}
        >
          <div className="section-heading">
            <div>
              <span className="eyebrow">NEW GUIDED PROJECT</span>
              <h2>Ask your what-if question</h2>
            </div>
          </div>
          {initialProject && (
            <Notice>
              Duplicating inputs only. No graphs, agents, simulation results or reports are copied.
            </Notice>
          )}
          {loaded && (
            <Notice
              tone={loaded.evidence ? 'info' : 'warning'}
              title={
                loaded.evidence ? `Example loaded: ${loaded.title}` : 'Fictional starter INPUT'
              }
            >
              {loaded.evidence
                ? `The question and evidence (${loaded.evidence}) came from this example. Read them, change what you like, then build. No results come with an example.`
                : 'This editable input is invented for learning the workflow. No prerecorded outputs or case-study results are included.'}
            </Notice>
          )}
          <section className="form-section question-section">
            <div className="field">
              <label htmlFor="project-question">Your what-if question</label>
              <textarea
                id="project-question"
                ref={questionField}
                aria-describedby={`${questionHelpId} ${validationId}`}
                aria-invalid={Boolean(error) && question.trim().length < 10}
                required
                minLength={10}
                maxLength={2_000}
                rows={4}
                value={question}
                disabled={disabled}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="What could happen if …? For example: a price change, a product integration, a new policy or a launch."
              />
              <small id={questionHelpId}>
                One or two sentences are enough. Swarm shows how it understood the question and lets
                you correct it.
              </small>
            </div>
            <ExamplePicker
              examples={examples}
              disabled={disabled}
              onPick={chooseExample}
              onStarter={chooseStarter}
            />
          </section>
          <ScenarioIntake
            question={question}
            frame={frame}
            onFrame={setFrame}
            disabled={disabled}
          />
          <div className="evidence-group">
            <SourceInput
              config={config}
              documents={documents}
              onChange={setDocuments}
              disabled={busy}
              onPending={setReading}
              errorResetRef={clearFileError}
            />
            {urlIngestionEnabled(config) && (
              <UrlEvidence
                disabled={disabled}
                remainingDocuments={Math.max(0, maxDocuments - documents.length)}
                onAdd={(document) => {
                  setDocuments((old) => [...old, document]);
                  setError(null);
                }}
              />
            )}
          </div>
          <section className="form-section run-settings">
            <h3>Run settings</h3>
            <div className="field">
              <label htmlFor="project-name">Project name (optional)</label>
              <input
                id="project-name"
                aria-describedby={validationId}
                aria-invalid={Boolean(error) && name.trim().length > 0 && name.trim().length < 3}
                minLength={3}
                maxLength={100}
                value={name}
                disabled={disabled}
                onChange={(event) => setName(event.target.value)}
                placeholder="Defaults to the start of your question"
              />
            </div>
            <fieldset className="mode-options" disabled={disabled}>
              <legend className="sr-only">Execution mode</legend>
              <label className={settings.mode === 'local' ? 'selected' : ''}>
                <input
                  type="radio"
                  name="mode"
                  value="local"
                  checked={settings.mode === 'local'}
                  disabled={config ? !config.capabilities.local : true}
                  onChange={() => setMode('local')}
                />
                <span>
                  <strong>Local rules</strong>
                  <small>
                    Lexical graph · deterministic updates · evidence lookup. No model calls.
                  </small>
                </span>
              </label>
              <label className={settings.mode === 'llm' ? 'selected' : ''}>
                <input
                  type="radio"
                  name="mode"
                  value="llm"
                  checked={settings.mode === 'llm'}
                  disabled={!modelAvailable}
                  onChange={() => setMode('llm')}
                />
                <span>
                  <strong>Model assisted</strong>
                  <small>
                    Real provider calls for extraction, fictional actions and analysis. Requires
                    server configuration.
                  </small>
                </span>
              </label>
            </fieldset>
            {settings.mode === 'llm' && (
              <p className={`run-target${modelAvailable ? '' : ' run-target-off'}`}>
                {modelAvailable && config ? (
                  <>
                    <strong>Will run on:</strong> {realModelLabel(config.provider.name)} ·{' '}
                    {config.provider.model ?? 'model unspecified'} ·{' '}
                    {authText(config.provider.auth)}
                  </>
                ) : (
                  <>
                    <strong>Model assistance is unavailable:</strong>{' '}
                    {config?.provider.reason ?? 'Waiting for the local API configuration.'}
                  </>
                )}
              </p>
            )}
            <div className="fields-grid three">
              <div className="field">
                <label htmlFor="agent-count">Fictional proxies</label>
                <input
                  id="agent-count"
                  aria-describedby={validationId}
                  type="number"
                  min={4}
                  max={maxAgents}
                  required
                  value={settings.agentCount}
                  disabled={disabled}
                  onChange={(event) =>
                    setSettings({ ...settings, agentCount: Number(event.target.value) })
                  }
                />
                <small>4–{maxAgents}; fixed after preparation</small>
              </div>
              <div className="field">
                <label htmlFor="round-count">Rounds / platform</label>
                <input
                  id="round-count"
                  aria-describedby={validationId}
                  type="number"
                  min={3}
                  max={maxRounds}
                  required
                  value={settings.rounds}
                  disabled={disabled}
                  onChange={(event) =>
                    setSettings({ ...settings, rounds: Number(event.target.value) })
                  }
                />
                <small>3–{maxRounds}; editable in setup</small>
              </div>
              <div className="field">
                <label htmlFor="seed">Random seed</label>
                <input
                  id="seed"
                  aria-describedby={validationId}
                  type="number"
                  min={1}
                  max={2_147_483_647}
                  required
                  value={settings.seed}
                  disabled={disabled}
                  onChange={(event) =>
                    setSettings({ ...settings, seed: Number(event.target.value) })
                  }
                />
                <small>Reproducible local rules</small>
              </div>
            </div>
            {settings.intervention && (
              <Notice title="Copied intervention assumption">
                Round {settings.intervention.round}: {settings.intervention.label}
                <button
                  className="text-button"
                  type="button"
                  disabled={disabled}
                  onClick={() => setSettings({ ...settings, intervention: null })}
                >
                  Remove intervention
                </button>
              </Notice>
            )}
            <p className="field-help">
              Guided platforms are prepared in step 2: Info Plaza uses broadcast; Topic Community
              uses community links. Model outputs may vary even with the same seed.
            </p>
          </section>
          <div id={validationId} aria-live="polite" aria-atomic="true">
            {error && (
              <Notice tone="error" title="Cannot build this project">
                {error}
              </Notice>
            )}
          </div>
          <div className="entry-submit">
            <button
              className="button button-primary"
              type="submit"
              disabled={disabled || !config?.capabilities.guidedConsole}
            >
              {busy ? (
                <Spinner label="Creating and starting Graph Build" />
              ) : (
                <ArrowRight size={16} aria-hidden="true" />
              )}
              {busy ? 'Submitting…' : 'Build Graph'}
            </button>
            <small className="muted">
              Saves a draft, then starts Graph Build only. No environment, simulation or report runs
              until you request it.
            </small>
          </div>
        </form>
        <aside className="entry-aside" aria-label="About this console">
          {config?.storage?.warning && (
            <Notice tone="warning" title="Data directory is cloud-synchronized">
              {config.storage.warning}
            </Notice>
          )}
          <details className="aside-card readiness card" open={mode === 'advanced'}>
            <summary>
              <span>System readiness</span>
              <span className="mono muted">
                {config
                  ? config.capabilities.local
                    ? 'RULES ENGINE READY'
                    : 'RULES ENGINE UNAVAILABLE'
                  : 'READING…'}
              </span>
            </summary>
            <div className="readiness-row">
              {config?.capabilities.local ? (
                <CheckCircle2 size={16} aria-hidden="true" />
              ) : (
                <Circle size={16} aria-hidden="true" />
              )}
              <span>Local rules engine</span>
              <strong>
                {config ? (config.capabilities.local ? 'Available' : 'Unavailable') : 'Unknown'}
              </strong>
            </div>
            <div className="readiness-row">
              {readiness.failing ? (
                <TriangleAlert size={16} aria-hidden="true" />
              ) : modelAvailable ? (
                <CheckCircle2 size={16} aria-hidden="true" />
              ) : (
                <Circle size={16} aria-hidden="true" />
              )}
              <span>Model provider</span>
              <strong>{config ? readiness.label : 'Unknown'}</strong>
            </div>
            <p>{config?.provider.reason ?? 'Waiting for the local API configuration.'}</p>
            {config?.provider.configured && (
              <p className="mono">
                {config.provider.name} / {config.provider.model ?? 'model unspecified'}
              </p>
            )}
            <small>
              <Info size={13} aria-hidden="true" /> {readiness.note}
            </small>
          </details>
          <details className="aside-card stage-guide card" open={mode === 'advanced'}>
            <summary>
              <span>How the five console stages work</span>
            </summary>
            <ol className="entry-steps">
              {explanations.map(([title, text], index) => (
                <li key={title}>
                  <span className="step-number">{index + 1}</span>
                  <div>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </details>
          <Notice title="A scenario laboratory, not a forecast">
            All personas are fictional proxies. Simulated positions and model-written answers are
            neither calibrated predictions nor real-person thoughts. Source evidence and simulated
            memories stay visibly distinct.
          </Notice>
          <button className="button button-secondary" type="button" onClick={onHistory}>
            <History size={15} aria-hidden="true" /> Open saved projects
          </button>
        </aside>
      </div>
      {demoHistory && onOpenProject && (
        <DemoWorkspace
          history={demoHistory}
          busy={busy}
          onOpen={onOpenProject}
          onRetry={onRetryHistory ?? (() => undefined)}
        />
      )}
    </div>
  );
}
