import { useState } from 'react';
import { ArrowRight, LockKeyhole, Save } from 'lucide-react';
import { environmentUpdateSchema } from '../../../../shared/guided';
import type {
  ConsoleStep,
  EnvironmentUpdate,
  ExecutionStep,
  Platform,
} from '../../../../shared/guided';
import type { ProjectDetail } from '../../../../shared/types';
import { errorMessage } from '../../api';
import { canExecute, isBusy, isGuided, platformNames, stepStatus } from '../../lib/console';
import type { Inspection } from '../../lib/graph';
import { EmptyPanel, Notice, Spinner } from '../ui';
import { Citations } from './Citations';
import { PersonaEditor } from './PersonaEditor';
import { RunStepButton, StageStatus } from './StageControls';

function environmentInput(project: ProjectDetail): EnvironmentUpdate {
  const environment = project.console!.environment!;
  return {
    rounds: project.settings.rounds,
    minutesPerRound: environment.minutesPerRound,
    platforms: environment.platforms,
    initialPosts: environment.initialPosts,
    agents: project.agents.map(
      ({ id, name, role, persona, initialOpinion, influence, openness }) => ({
        id,
        name,
        role,
        persona,
        initialOpinion,
        influence,
        openness,
      }),
    ),
  };
}

function EnvironmentEditor({
  project,
  initial,
  busy,
  onSave,
  onRun,
  onNavigate,
  onInspect,
}: {
  project: ProjectDetail;
  initial: EnvironmentUpdate;
  busy: boolean;
  onSave: (input: EnvironmentUpdate) => Promise<void>;
  onRun: (step: ExecutionStep) => void;
  onNavigate: (step: ConsoleStep) => void;
  onInspect: (selection: Inspection) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editable =
    stepStatus(project, 'environment') === 'ready' &&
    stepStatus(project, 'simulation') === 'pending' &&
    !isBusy(project) &&
    project.status !== 'completed';
  const disabled = !editable || busy || saving;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const maxRounds = project.mode === 'llm' ? 10 : 24;
  const save = async () => {
    const parsed = environmentUpdateSchema.safeParse(draft);
    if (!parsed.success) {
      setError(
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'),
      );
      return;
    }
    if (draft.rounds > maxRounds) {
      setError(`This mode supports at most ${maxRounds} rounds.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(parsed.data);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  };
  const togglePlatform = (platform: Platform) => {
    setDraft((old) => ({
      ...old,
      platforms: old.platforms.includes(platform)
        ? old.platforms.filter((item) => item !== platform)
        : [...old.platforms, platform],
    }));
  };
  return (
    <div className="view-stack">
      <div className="stage-actions primary-stage-actions">
        {editable && (
          <button
            className="button button-secondary"
            type="button"
            disabled={disabled || !dirty}
            onClick={() => void save()}
          >
            {saving ? <Spinner label="Saving environment" /> : <Save size={15} />} Save environment
          </button>
        )}
        {!dirty &&
          (project.rounds.length > 0 &&
          ['paused', 'failed', 'cancelled'].includes(project.console?.steps.simulation ?? '') ? (
            <button
              className="button button-primary"
              type="button"
              onClick={() => onNavigate('simulation')}
            >
              Review saved checkpoint recovery
            </button>
          ) : (
            <RunStepButton
              project={project}
              step="simulation"
              busy={busy || saving}
              onRun={onRun}
              label="Start Simulation"
            />
          ))}
        {!canExecute(project, 'simulation') && project.console?.steps.simulation !== 'pending' && (
          <button
            className="button button-secondary"
            type="button"
            onClick={() => onNavigate('simulation')}
          >
            Inspect simulation <ArrowRight size={14} />
          </button>
        )}
      </div>
      {dirty && (
        <p className="unsaved-note" role="status">
          Unsaved assumptions. Save the environment before starting simulation; navigation discards
          unsaved edits.
        </p>
      )}
      {editable && !dirty && (
        <p className="field-help">
          The saved environment is up to date; Save is disabled until an assumption changes.
        </p>
      )}
      {!editable && (
        <div className="readonly-note">
          <LockKeyhole size={14} /> Read-only recorded environment. Editing closes when simulation
          starts.
        </div>
      )}
      <section className="stage-card">
        <h3>Timing &amp; platforms</h3>
        <div className="fields-grid">
          <div className="field">
            <label htmlFor="env-rounds">Rounds per selected platform</label>
            <input
              id="env-rounds"
              type="number"
              min={3}
              max={maxRounds}
              value={draft.rounds}
              disabled={disabled}
              onChange={(event) => setDraft({ ...draft, rounds: Number(event.target.value) })}
            />
          </div>
          <div className="field">
            <label htmlFor="env-minutes">Scenario minutes / round</label>
            <input
              id="env-minutes"
              type="number"
              min={5}
              max={180}
              value={draft.minutesPerRound}
              disabled={disabled}
              onChange={(event) =>
                setDraft({ ...draft, minutesPerRound: Number(event.target.value) })
              }
            />
          </div>
        </div>
        <fieldset className="platform-options" disabled={disabled}>
          <legend>Run at least one platform</legend>
          <label>
            <input
              type="checkbox"
              checked={draft.platforms.includes('plaza')}
              onChange={() => togglePlatform('plaza')}
            />
            <span>
              <strong>Info Plaza</strong>
              <small>Broadcast network</small>
            </span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.platforms.includes('community')}
              onChange={() => togglePlatform('community')}
            />
            <span>
              <strong>Topic Community</strong>
              <small>Community network</small>
            </span>
          </label>
        </fieldset>
        <p className="field-help">
          These are scenario minutes, not a wall-clock countdown. Recorded action time advances only
          when simulation rounds are saved.
        </p>
      </section>
      <section className="stage-card">
        <div className="section-heading">
          <h3>Initial seed inputs</h3>
          <span className="mono muted">{draft.initialPosts.length} RECORDED</span>
        </div>
        <p className="field-help">
          Seed text, stance and strength are explicit assumptions, not observed audience sentiment.
          Source links are retained unchanged.
        </p>
        {draft.initialPosts.map((post, index) => (
          <div className="seed-card" key={post.id}>
            <span className="eyebrow">ASSUMED INPUT · {post.id}</span>
            <div className="field">
              <label htmlFor={`seed-${post.id}-text`}>Seed text</label>
              <textarea
                id={`seed-${post.id}-text`}
                rows={3}
                minLength={10}
                maxLength={500}
                value={post.text}
                disabled={disabled}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    initialPosts: draft.initialPosts.map((item, i) =>
                      i === index ? { ...item, text: event.target.value } : item,
                    ),
                  })
                }
              />
            </div>
            <div className="fields-grid three">
              <div className="field">
                <label htmlFor={`seed-${post.id}-platform`}>Platform</label>
                <select
                  id={`seed-${post.id}-platform`}
                  value={post.platform}
                  disabled={disabled}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      initialPosts: draft.initialPosts.map((item, i) =>
                        i === index
                          ? { ...item, platform: event.target.value as typeof post.platform }
                          : item,
                      ),
                    })
                  }
                >
                  <option value="both">Both platforms</option>
                  <option value="plaza">{platformNames.plaza}</option>
                  <option value="community">{platformNames.community}</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor={`seed-${post.id}-stance`}>Assumed stance</label>
                <input
                  id={`seed-${post.id}-stance`}
                  type="number"
                  min={-1}
                  max={1}
                  step={0.01}
                  value={post.stance}
                  disabled={disabled}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      initialPosts: draft.initialPosts.map((item, i) =>
                        i === index ? { ...item, stance: Number(event.target.value) } : item,
                      ),
                    })
                  }
                />
              </div>
              <div className="field">
                <label htmlFor={`seed-${post.id}-strength`}>Assumed strength</label>
                <input
                  id={`seed-${post.id}-strength`}
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={post.strength}
                  disabled={disabled}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      initialPosts: draft.initialPosts.map((item, i) =>
                        i === index ? { ...item, strength: Number(event.target.value) } : item,
                      ),
                    })
                  }
                />
              </div>
            </div>
            <Citations sourceIds={post.sourceIds} onInspect={onInspect} />
          </div>
        ))}
        {!draft.initialPosts.length && (
          <p className="field-help">No initial posts were recorded for this environment.</p>
        )}
      </section>
      <section className="stage-card">
        <div className="section-heading">
          <h3>Fictional persona population</h3>
          <span className="mono muted">{draft.agents.length} FIXED PROXIES</span>
        </div>
        <p className="field-help">
          Edit assumptions before running. IDs, population count, topic links and source links
          cannot be changed here.
        </p>
        {draft.agents.map((agent, index) => (
          <PersonaEditor
            key={agent.id}
            agent={agent}
            source={project.agents.find((item) => item.id === agent.id)!}
            disabled={disabled}
            onInspect={onInspect}
            onChange={(value) =>
              setDraft({
                ...draft,
                agents: draft.agents.map((item, i) => (i === index ? value : item)),
              })
            }
          />
        ))}
      </section>
      {error && (
        <Notice tone="error" title="Environment was not saved">
          {error}
        </Notice>
      )}
    </div>
  );
}

export function EnvironmentStage({
  project,
  busy,
  onSave,
  onRun,
  onNavigate,
  onInspect,
}: {
  project: ProjectDetail;
  busy: boolean;
  onSave: (input: EnvironmentUpdate) => Promise<void>;
  onRun: (step: ExecutionStep) => void;
  onNavigate: (step: ConsoleStep) => void;
  onInspect: (selection: Inspection) => void;
}) {
  const guided = isGuided(project);
  const input = project.console?.environment ? environmentInput(project) : null;
  return (
    <div className="stage-content view-stack">
      <div>
        <span className="eyebrow">02 / ENVIRONMENT SETUP</span>
        <h2>Make the assumptions explicit</h2>
      </div>
      <StageStatus project={project} step="environment" />
      <Notice tone="warning" title="Fictional proxies, not digital copies of people">
        Personas and numeric inclinations are generated scenario assumptions. Citation links provide
        context, not proof of a real person’s beliefs.
        {project.console?.environment &&
          ` Prepared by ${project.console.environment.generatedBy === 'local' ? 'local rules' : 'real model assistance'}${project.console.environment.edited ? '; user edits saved' : '; not yet edited'}.`}
      </Notice>
      <RunStepButton
        project={project}
        step="environment"
        busy={busy}
        onRun={onRun}
        label="Prepare fictional environment"
      />
      {input ? (
        <EnvironmentEditor
          key={JSON.stringify(input)}
          project={project}
          initial={input}
          busy={busy}
          onSave={onSave}
          onRun={onRun}
          onNavigate={onNavigate}
          onInspect={onInspect}
        />
      ) : guided ? (
        <EmptyPanel title="No prepared environment yet">
          Prepare this stage after Graph Build is ready. Population, seed inputs and timing appear
          only when returned by the API.
        </EmptyPanel>
      ) : (
        <section className="stage-card">
          <h3>Recorded quick-run proxies</h3>
          <p className="field-help">
            Read-only. This quick run has no guided environment, prepared seed-post list or
            dual-platform configuration.
          </p>
          {project.agents.map((agent) => (
            <button
              className="document-row"
              type="button"
              key={agent.id}
              onClick={() => onInspect({ kind: 'agent', id: agent.id })}
            >
              <span className="proxy-avatar">{agent.name.slice(0, 1)}</span>
              <span>
                <strong>{agent.name}</strong>
                <small>{agent.role}</small>
              </span>
              <ArrowRight size={14} />
            </button>
          ))}
          {!project.agents.length && (
            <p className="field-help">No fictional proxies were recorded.</p>
          )}
        </section>
      )}
    </div>
  );
}
