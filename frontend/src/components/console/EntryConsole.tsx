import { useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowRight, CheckCircle2, Circle, FlaskConical, History, Info } from 'lucide-react';
import { createProjectSchema } from '../../../../shared/types';
import type {
  AppConfig,
  CreateProjectInput,
  ProjectDetail,
  SimulationSettings,
} from '../../../../shared/types';
import { errorMessage } from '../../api';
import { SourceInput } from './SourceInput';
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
    },
  ],
};

export function EntryConsole({
  config,
  initialProject,
  busy,
  onSubmit,
  onHistory,
}: {
  config: AppConfig | null;
  initialProject?: ProjectDetail;
  busy: boolean;
  onSubmit: (input: CreateProjectInput) => Promise<void>;
  onHistory: () => void;
}) {
  const [name, setName] = useState(
    initialProject ? `${initialProject.name.slice(0, 80)} (guided)` : '',
  );
  const [question, setQuestion] = useState(initialProject?.question ?? '');
  const [documents, setDocuments] = useState<CreateProjectInput['documents']>(
    initialProject?.documents.map(({ name, content, pageCount }) => ({
      name,
      content,
      ...(pageCount ? { pageCount } : {}),
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
  const [usedStarter, setUsedStarter] = useState(false);
  const modelAvailable = Boolean(config?.capabilities.modelAssisted && config.provider.configured);
  const maxAgents =
    settings.mode === 'llm'
      ? (config?.limits.modelMaxAgents ?? 10)
      : (config?.limits.localMaxAgents ?? 24);
  const maxRounds =
    settings.mode === 'llm'
      ? (config?.limits.modelMaxRounds ?? 10)
      : (config?.limits.localMaxRounds ?? 24);
  const disabled = busy || reading;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled) return;
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
    const parsed = createProjectSchema.safeParse({
      name,
      question,
      documents,
      settings,
      workflow: 'guided',
    });
    if (!parsed.success) {
      setError(
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'),
      );
      return;
    }
    setError(null);
    try {
      await onSubmit(parsed.data);
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
      <section className="entry-guide">
        <div className="entry-title">
          <span className="eyebrow">GUIDED SCENARIO CONSOLE</span>
          <h1>
            From sources to a<br />
            testable scenario.
          </h1>
          <p>
            Build, inspect, prepare, run. Each stage executes separately and waits for your review.
          </p>
        </div>
        <div className="readiness card">
          <div className="section-heading">
            <h2>System readiness</h2>
            <span className="mono">LIVE CONFIG</span>
          </div>
          <div className="readiness-row">
            {config?.capabilities.local ? <CheckCircle2 size={16} /> : <Circle size={16} />}
            <span>Local rules engine</span>
            <strong>
              {config ? (config.capabilities.local ? 'Available' : 'Unavailable') : 'Unknown'}
            </strong>
          </div>
          <div className="readiness-row">
            {modelAvailable ? <CheckCircle2 size={16} /> : <Circle size={16} />}
            <span>Model provider</span>
            <strong>
              {config ? (modelAvailable ? 'Configured' : 'Not configured') : 'Unknown'}
            </strong>
          </div>
          <p>{config?.provider.reason ?? 'Waiting for the local API configuration.'}</p>
          {config?.provider.configured && (
            <p className="mono">
              {config.provider.name} / {config.provider.model ?? 'model unspecified'}
            </p>
          )}
          <small>
            <Info size={13} aria-hidden="true" /> Configured is not a connectivity check. Real
            provider errors are shown when a model operation runs.
          </small>
          {config?.storage?.warning && (
            <Notice tone="warning" title="Data directory is cloud-synchronized">
              {config.storage.warning}
            </Notice>
          )}
        </div>
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
        <Notice title="A scenario laboratory, not a forecast">
          All personas are fictional proxies. Simulated positions and model-written answers are
          neither calibrated predictions nor real-person thoughts. Source evidence and simulated
          memories stay visibly distinct.
        </Notice>
        <button className="button button-secondary" type="button" onClick={onHistory}>
          <History size={15} aria-hidden="true" /> Open saved projects
        </button>
      </section>
      <form className="entry-form card" onSubmit={(event) => void submit(event)} aria-busy={busy}>
        <div className="section-heading">
          <div>
            <span className="eyebrow">NEW GUIDED PROJECT</span>
            <h2>Define your scenario</h2>
          </div>
          <FlaskConical size={22} aria-hidden="true" />
        </div>
        {initialProject && (
          <Notice>
            Duplicating inputs only. No graphs, agents, simulation results or reports are copied.
          </Notice>
        )}
        {usedStarter && (
          <Notice tone="warning" title="Fictional starter INPUT">
            This editable input is invented for learning the workflow. No prerecorded outputs or
            case-study results are included.
          </Notice>
        )}
        <SourceInput
          config={config}
          documents={documents}
          onChange={setDocuments}
          disabled={busy}
          onPending={setReading}
        />
        <section className="form-section">
          <h3>02 / Question &amp; identity</h3>
          <div className="field">
            <label htmlFor="project-name">Project name</label>
            <input
              id="project-name"
              required
              minLength={3}
              maxLength={100}
              value={name}
              disabled={disabled}
              onChange={(event) => setName(event.target.value)}
              placeholder="A short scenario name"
            />
          </div>
          <div className="field">
            <label htmlFor="project-question">Research question</label>
            <textarea
              id="project-question"
              required
              minLength={10}
              maxLength={2_000}
              rows={3}
              value={question}
              disabled={disabled}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="What do you want to explore using these sources?"
            />
          </div>
        </section>
        <section className="form-section">
          <h3>03 / Execution assumptions</h3>
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
          <div className="fields-grid three">
            <div className="field">
              <label htmlFor="agent-count">Fictional proxies</label>
              <input
                id="agent-count"
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
                type="number"
                min={1}
                max={2_147_483_647}
                required
                value={settings.seed}
                disabled={disabled}
                onChange={(event) => setSettings({ ...settings, seed: Number(event.target.value) })}
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
            Guided platforms are prepared in step 2: Info Plaza uses broadcast; Topic Community uses
            community links. Model outputs may vary even with the same seed.
          </p>
        </section>
        {error && (
          <Notice tone="error" title="Cannot build this project">
            {error}
          </Notice>
        )}
        <div className="entry-submit">
          <button
            className="text-button"
            type="button"
            disabled={disabled}
            onClick={() => {
              setName(starter.name);
              setQuestion(starter.question);
              setDocuments(starter.documents);
              setUsedStarter(true);
              setError(null);
            }}
          >
            Load fictional starter input
          </button>
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
        </div>
        <small className="muted">
          Saves a draft, then starts Graph Build only. No environment, simulation or report runs
          until you request it.
        </small>
      </form>
    </div>
  );
}
