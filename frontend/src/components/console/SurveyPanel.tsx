import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ClipboardList, Square } from 'lucide-react';
import { MAX_SURVEYS, surveyInputSchema } from '../../../../shared/guided';
import type { SurveyInput, SurveyRecord } from '../../../../shared/guided';
import type { AppConfig, ProjectDetail } from '../../../../shared/types';
import { api, errorMessage } from '../../api';
import { dateTime, signed } from '../../lib/format';
import type { Inspection } from '../../lib/graph';
import { EmptyPanel, Notice, Spinner } from '../ui';
import { Citations } from './Citations';

export function SurveyPanel({
  project,
  config,
  onRecord,
  onInspect,
}: {
  project: ProjectDetail;
  config: AppConfig | null;
  onRecord: (survey: SurveyRecord) => void;
  onInspect: (selection: Inspection) => void;
}) {
  const [kind, setKind] = useState<SurveyInput['kind']>('state');
  const [question, setQuestion] = useState('');
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const surveys = project.console?.surveys ?? [];
  const active = surveys.some(
    (survey) => survey.status === 'queued' || survey.status === 'running',
  );
  const maxTargets = Math.min(5, config?.limits.maxSurveyTargets ?? 5);
  const modelAvailable =
    project.mode === 'llm' &&
    Boolean(config?.provider.configured && config.capabilities.modelAssisted);
  const enabled = Boolean(
    project.console &&
    config?.capabilities.surveys &&
    project.status === 'completed' &&
    project.report,
  );
  useEffect(() => () => request.current?.abort(), []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (lock.current || !enabled || active || surveys.length >= MAX_SURVEYS) return;
    const parsed = surveyInputSchema.safeParse({ kind, question, agentIds });
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join(' '));
      return;
    }
    if (kind === 'interview' && !modelAvailable) {
      setError(
        'Real AI interviews require a model-assisted project and a configured provider. There is no local interview fallback.',
      );
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      const record = await api.survey(project.id, parsed.data, controller.signal);
      if (!controller.signal.aborted) {
        onRecord(record);
        setQuestion('');
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(errorMessage(failure));
    } finally {
      if (!controller.signal.aborted) {
        lock.current = false;
        setPending(false);
      }
    }
  };
  const cancel = async (id: string) => {
    if (lock.current) return;
    const controller = new AbortController();
    request.current = controller;
    lock.current = true;
    setCancelling(id);
    setError(null);
    try {
      const record = await api.cancelSurvey(project.id, id, controller.signal);
      if (!controller.signal.aborted) onRecord(record);
    } catch (failure) {
      if (!controller.signal.aborted) setError(errorMessage(failure));
    } finally {
      if (!controller.signal.aborted) {
        lock.current = false;
        setCancelling(null);
      }
    }
  };
  return (
    <div className="view-stack survey-panel">
      <Notice title="Snapshots and fictional interviews are different">
        A state snapshot records numeric proxy positions without answering your question (answer is
        null). An AI interview makes real provider calls for fictional answers, only on a
        model-assisted project. Neither is a poll of real people or a calibrated forecast.
      </Notice>
      {!project.console && (
        <Notice tone="warning">
          This historical quick run has no guided survey storage. Duplicate its inputs as a guided
          project to use surveys.
        </Notice>
      )}
      {project.console && !config?.capabilities.surveys && (
        <Notice tone="warning">
          The server has not advertised survey capability. Saved results remain readable.
        </Notice>
      )}
      <form className="survey-form stage-card" onSubmit={(event) => void submit(event)}>
        <div className="section-heading">
          <h3>New proxy survey</h3>
          <span className="mono muted">
            {surveys.length} / {MAX_SURVEYS} SAVED
          </span>
        </div>
        <fieldset
          className="survey-kind"
          disabled={!enabled || pending || active || surveys.length >= MAX_SURVEYS}
        >
          <legend>Survey kind</legend>
          <label>
            <input
              type="radio"
              name="survey-kind"
              checked={kind === 'state'}
              onChange={() => setKind('state')}
            />{' '}
            State snapshot (no AI answer)
          </label>
          <label>
            <input
              type="radio"
              name="survey-kind"
              checked={kind === 'interview'}
              disabled={!modelAvailable}
              onChange={() => setKind('interview')}
            />{' '}
            Real AI interview
          </label>
        </fieldset>
        {!modelAvailable && (
          <p className="field-help">
            AI interviews are unavailable: select a model-assisted project with a configured
            provider. Local snapshots still work on guided local projects.
          </p>
        )}
        <div className="field">
          <label htmlFor="survey-question">
            {kind === 'state' ? 'Snapshot question / context label' : 'Interview question'}
          </label>
          <textarea
            id="survey-question"
            rows={3}
            minLength={5}
            maxLength={1_000}
            required
            value={question}
            disabled={!enabled || pending || active || surveys.length >= MAX_SURVEYS}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={
              kind === 'state'
                ? 'What recorded scenario position do you want to snapshot?'
                : 'Ask selected fictional proxies a question about this scenario…'
            }
          />
        </div>
        <fieldset
          className="survey-targets"
          disabled={!enabled || pending || active || surveys.length >= MAX_SURVEYS}
        >
          <legend>
            Choose 1–{maxTargets} fictional proxies{' '}
            <span className="mono">{agentIds.length} SELECTED</span>
          </legend>
          {project.agents.map((agent) => (
            <label key={agent.id}>
              <input
                type="checkbox"
                checked={agentIds.includes(agent.id)}
                disabled={!agentIds.includes(agent.id) && agentIds.length >= maxTargets}
                onChange={() =>
                  setAgentIds((old) =>
                    old.includes(agent.id)
                      ? old.filter((id) => id !== agent.id)
                      : [...old, agent.id],
                  )
                }
              />
              <span>
                <strong>{agent.name}</strong>
                <small>{agent.role}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <button
          className="button button-primary button-small"
          type="submit"
          disabled={
            !enabled ||
            pending ||
            active ||
            surveys.length >= MAX_SURVEYS ||
            !agentIds.length ||
            question.trim().length < 5 ||
            (kind === 'interview' && !modelAvailable)
          }
        >
          {pending ? <Spinner label="Submitting survey" /> : <ClipboardList size={15} />}
          {pending
            ? 'Submitting…'
            : kind === 'state'
              ? 'Record state snapshot'
              : 'Start AI interviews'}
        </button>
        {active && (
          <p className="field-help">
            A persisted survey is queued / running. Results below update through project polling.
            Finish or cancel it before starting another.
          </p>
        )}
        {surveys.length >= MAX_SURVEYS && (
          <p className="field-help">This project has reached its {MAX_SURVEYS}-survey limit.</p>
        )}
      </form>
      {error && (
        <Notice tone="error" title="Survey request failed">
          {error} Refresh the project to confirm its latest state before retrying.
        </Notice>
      )}
      {!surveys.length && (
        <EmptyPanel title="No surveys recorded">
          Choose proxies and submit a real snapshot or interview request. No survey results are
          prefilled.
        </EmptyPanel>
      )}
      {surveys
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((survey) => {
          const running = survey.status === 'queued' || survey.status === 'running';
          return (
            <section className={`survey-record survey-${survey.status} stage-card`} key={survey.id}>
              <div className="section-heading">
                <span className="eyebrow">
                  {survey.kind === 'state' ? 'STATE SNAPSHOT' : 'REAL AI / FICTIONAL INTERVIEW'}
                </span>
                <span className="mono">
                  {running && <Spinner label={`Survey ${survey.status}`} />} {survey.status}
                </span>
              </div>
              <h3>{survey.question}</h3>
              <div className="record-meta mono">
                {dateTime(survey.createdAt)} · {survey.responses.length}/{survey.agentIds.length}{' '}
                SAVED RESPONSES
              </div>
              <small className="mono muted">{survey.id}</small>
              {running && (
                <button
                  className="button button-danger button-small"
                  type="button"
                  disabled={pending || Boolean(cancelling)}
                  onClick={() => void cancel(survey.id)}
                >
                  <Square size={12} /> {cancelling === survey.id ? 'Cancelling…' : 'Cancel survey'}
                </button>
              )}
              {survey.error && <Notice tone="error">{survey.error}</Notice>}
              {survey.status === 'cancelled' && (
                <p className="field-help">
                  Cancelled. Any responses saved before cancellation are retained below.
                </p>
              )}
              {survey.responses.map((response) => (
                <article className="survey-response" key={response.agentId}>
                  <div className="section-heading">
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => onInspect({ kind: 'agent', id: response.agentId })}
                    >
                      {project.agents.find((agent) => agent.id === response.agentId)?.name ??
                        response.agentId}
                    </button>
                    <span className="mono">
                      {response.position} / {signed(response.opinion)}
                    </span>
                  </div>
                  {response.answer === null ? (
                    <p className="snapshot-null">
                      <strong>answer: null</strong> — recorded numeric state only; no fictional
                      speech was generated.
                    </p>
                  ) : (
                    <p className="preserve-text">{response.answer}</p>
                  )}
                  <Citations
                    sourceIds={response.sourceIds}
                    memoryIds={response.memoryIds}
                    onInspect={onInspect}
                  />
                </article>
              ))}
            </section>
          );
        })}
    </div>
  );
}
