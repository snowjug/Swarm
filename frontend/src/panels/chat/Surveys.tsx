import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ClipboardList, Square } from 'lucide-react';
import { MAX_SURVEYS, surveyInputSchema } from '../../../../shared/guided';
import type { SurveyInput, SurveyRecord, SurveyResponse } from '../../../../shared/guided';
import type { AppConfig, ProjectDetail } from '../../../../shared/types';
import { api, errorMessage } from '../../api';
import {
  Button,
  Chip,
  ChipButton,
  EmptyState,
  Field,
  Notice,
  Orbit,
  Segmented,
  Skeleton,
  Textarea,
} from '../../design/ui';
import { signed } from '../../lib/format';
import { Orb } from '../shared/Orb';
import { clockTime, dayLabel, fullTime } from '../shared/time';
import {
  actorName,
  awaiting,
  canStartSurvey,
  isActive,
  maxTargets,
  newestSurveyFirst,
  positionLabel,
  positionTone,
  type Availability,
} from './chatView';
import { Citations } from './Citations';
import { StanceTrack } from './StanceTrack';

type Kind = SurveyInput['kind'];

function Answer({
  response,
  project,
  onOpenActor,
}: {
  response: SurveyResponse;
  project: ProjectDetail;
  onOpenActor: (id: string) => void;
}) {
  const name = actorName(project.agents, response.agentId);
  return (
    <li className="sw-chat__answer">
      <Orb seed={response.agentId} size={28} />
      <div className="sw-chat__answer-main">
        <div className="sw-chat__answer-head">
          <button
            type="button"
            className="sw-chat__link"
            aria-label={`Open the conversation with ${name}`}
            onClick={() => onOpenActor(response.agentId)}
          >
            {name}
          </button>
          <Chip tone={positionTone(response.position)} size="sm" dot>
            {positionLabel(response.position)}
          </Chip>
          <span className="sw-chat__signed num">{signed(response.opinion)}</span>
          <StanceTrack now={response.opinion} />
        </div>
        {response.answer === null ? (
          <p className="sw-caption">Recorded position only: no one answered.</p>
        ) : (
          <p className="sw-chat__text">{response.answer}</p>
        )}
        <Citations
          project={project}
          sourceIds={response.sourceIds}
          memoryIds={response.memoryIds}
        />
      </div>
    </li>
  );
}

const STATUS_TONE = {
  completed: 'favor',
  failed: 'critical',
  cancelled: 'neutral',
  queued: 'accent',
  running: 'accent',
} as const;

function SurveyCard({
  survey,
  project,
  cancelling,
  locked,
  onCancel,
  onOpenActor,
}: {
  survey: SurveyRecord;
  project: ProjectDetail;
  cancelling: boolean;
  locked: boolean;
  onCancel: (id: string) => void;
  onOpenActor: (id: string) => void;
}) {
  const running = isActive(survey);
  const waiting = running ? awaiting(survey) : [];
  return (
    <section
      className="sw-chat__survey sw-rise"
      data-status={survey.status}
      aria-label={`Survey: ${survey.question}`}
    >
      <header className="sw-chat__survey-head">
        <span className="sw-eyebrow">{survey.kind === 'state' ? 'Snapshot' : 'Interview'}</span>
        <Chip tone={STATUS_TONE[survey.status]} size="sm" dot>
          {survey.status[0]!.toUpperCase() + survey.status.slice(1)}
        </Chip>
      </header>
      <h3 className="sw-chat__survey-question">{survey.question}</h3>
      <p className="sw-pmeta sw-chat__survey-meta">
        <time dateTime={survey.createdAt} title={fullTime(survey.createdAt)}>
          {dayLabel(survey.createdAt)}, {clockTime(survey.createdAt)}
        </time>
        <span className="num">
          {survey.responses.length} of {survey.agentIds.length} answered
        </span>
      </p>
      {running && (
        <div className="sw-chat__running" role="status">
          <Orbit size={18} label={`Survey ${survey.status}`} />
          <span>Results arrive as they are saved.</span>
          <Button
            size="sm"
            variant="danger"
            disabled={locked}
            busy={cancelling}
            busyLabel="Cancelling"
            icon={<Square size={12} />}
            onClick={() => onCancel(survey.id)}
          >
            Cancel survey
          </Button>
        </div>
      )}
      {survey.error && (
        <Notice tone="error" title="The survey stopped">
          {survey.error}
        </Notice>
      )}
      {survey.status === 'cancelled' && (
        <p className="sw-caption">Cancelled. Responses saved before it stopped are kept.</p>
      )}
      {(survey.responses.length > 0 || waiting.length > 0) && (
        <ul className="sw-chat__answers" role="list">
          {survey.responses.map((response) => (
            <Answer
              key={response.agentId}
              response={response}
              project={project}
              onOpenActor={onOpenActor}
            />
          ))}
          {waiting.map((id) => (
            <li
              key={id}
              className="sw-chat__answer is-waiting"
              aria-label={`Waiting for ${actorName(project.agents, id)}`}
            >
              <Orb seed={id} size={28} />
              <div className="sw-chat__answer-main">
                <span className="sw-chat__answer-head">
                  <span className="sw-chat__link is-quiet">{actorName(project.agents, id)}</span>
                </span>
                <Skeleton width="70%" height="0.9rem" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Asking several actors the same thing at once, and the surveys that were kept. */
export function Surveys({
  project,
  config,
  availability,
  onSurvey,
  onOpenActor,
  seed,
}: {
  project: ProjectDetail;
  config: AppConfig | null;
  availability: Availability;
  onSurvey: (record: SurveyRecord) => void;
  onOpenActor: (id: string) => void;
  /** A question to start with, written into the field but not sent. */
  seed?: string;
}) {
  const id = useId();
  const surveys = project.console?.surveys ?? [];
  const [kind, setKind] = useState<Kind>('state');
  const [question, setQuestion] = useState(seed ?? '');
  const [chosen, setChosen] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const limit = maxTargets(config);
  const enabled = availability.ready && availability.surveysOn;
  const active = surveys.some(isActive);
  const full = surveys.length >= MAX_SURVEYS;
  const interviewOk = availability.modelReady;
  const frozen = !enabled || pending || active || full;
  const ready = canStartSurvey({
    enabled,
    surveys,
    question,
    chosen: chosen.length,
    kind,
    modelReady: interviewOk,
  });

  useEffect(() => () => request.current?.abort(), []);
  // A kind that cannot be used is not left chosen.
  useEffect(() => {
    if (kind === 'interview' && !interviewOk) setKind('state');
  }, [kind, interviewOk]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (lock.current || !ready) return;
    const parsed = surveyInputSchema.safeParse({ kind, question, agentIds: chosen });
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join(' '));
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
        onSurvey(record);
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

  const cancel = async (surveyId: string) => {
    if (lock.current) return;
    const controller = new AbortController();
    request.current = controller;
    lock.current = true;
    setCancelling(surveyId);
    setError(null);
    try {
      onSurvey(await api.cancelSurvey(project.id, surveyId, controller.signal));
    } catch (failure) {
      if (!controller.signal.aborted) setError(errorMessage(failure));
    } finally {
      if (!controller.signal.aborted) {
        lock.current = false;
        setCancelling(null);
      }
    }
  };

  if (!project.agents.length) {
    return (
      <EmptyState icon={<ClipboardList size={22} aria-hidden="true" />} title="No actors recorded">
        This record has no actors to ask.
      </EmptyState>
    );
  }

  // A survey that is under way comes first, with the means to stop it, since the form below is held while it runs.
  const ordered = newestSurveyFirst(surveys);
  const live = ordered.filter(isActive);
  const past = ordered.filter((survey) => !isActive(survey));
  const card = (survey: SurveyRecord) => (
    <SurveyCard
      key={survey.id}
      survey={survey}
      project={project}
      cancelling={cancelling === survey.id}
      locked={pending || cancelling !== null}
      onCancel={(surveyId) => void cancel(surveyId)}
      onOpenActor={onOpenActor}
    />
  );

  return (
    <div className="sw-chat__surveys">
      {live.map(card)}
      <form className="sw-chat__survey-form" noValidate onSubmit={(event) => void submit(event)}>
        <div className="sw-chat__form-head">
          <h3 className="sw-heading">Ask several at once</h3>
          <span className="sw-caption num">
            {surveys.length} of {MAX_SURVEYS} kept
          </span>
        </div>
        <Segmented
          label="Kind of survey"
          size="sm"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'state', label: 'Snapshot' },
            {
              value: 'interview',
              label: 'Interview',
              disabled: !interviewOk,
              hint: interviewOk
                ? undefined
                : 'needs a model-assisted project and a configured provider',
            },
          ]}
        />
        <p className="sw-caption">
          {kind === 'state'
            ? 'Records where each actor stands now. No one answers.'
            : 'The real model answers as each actor. Fictional answers, not a poll or a forecast.'}
          {!interviewOk && ' Interviews need a model-assisted project and a configured provider.'}
        </p>
        <Field label={kind === 'state' ? 'Snapshot question or label' : 'Interview question'}>
          <Textarea
            maxRows={5}
            maxLength={1_000}
            rows={2}
            value={question}
            disabled={frozen}
            placeholder={
              kind === 'state'
                ? 'What position do you want recorded?'
                : 'What do you want to ask them?'
            }
            onChange={(event) => setQuestion(event.target.value)}
          />
        </Field>
        <fieldset className="sw-chat__targets" disabled={frozen} aria-describedby={`${id}-count`}>
          <legend className="sw-field__label">
            Actors{' '}
            <span id={`${id}-count`} className="num">
              {chosen.length} of {limit}
            </span>
          </legend>
          <div className="sw-chat__chips">
            {project.agents.map((agent) => {
              const on = chosen.includes(agent.id);
              return (
                <ChipButton
                  key={agent.id}
                  pressed={on}
                  disabled={!on && chosen.length >= limit}
                  icon={<Orb seed={agent.id} size={16} />}
                  onClick={() =>
                    setChosen((old) =>
                      on ? old.filter((item) => item !== agent.id) : [...old, agent.id],
                    )
                  }
                >
                  {agent.name}
                </ChipButton>
              );
            })}
          </div>
        </fieldset>
        <div className="sw-chat__form-foot">
          <p className="sw-caption" role="status">
            {!enabled
              ? 'Surveys are not available for this record.'
              : active
                ? 'A survey is under way. Finish or cancel it to start another.'
                : full
                  ? `This exploration keeps at most ${MAX_SURVEYS} surveys.`
                  : ''}
          </p>
          <Button
            type="submit"
            variant="primary"
            busy={pending}
            busyLabel="Starting"
            disabled={!ready}
          >
            {kind === 'state' ? 'Record snapshot' : 'Start interviews'}
          </Button>
        </div>
      </form>

      {error && (
        <Notice tone="error" title="The survey request failed">
          {error} Refresh the exploration to confirm its latest state before trying again.
        </Notice>
      )}

      <p className="sw-chat__honest">
        Synthetic actors, not people. Their answers are never a poll or a forecast.
      </p>

      {surveys.length === 0 ? (
        <EmptyState icon={<ClipboardList size={22} aria-hidden="true" />} title="No surveys yet">
          Choose actors and ask. Nothing here is filled in for you.
        </EmptyState>
      ) : (
        past.map(card)
      )}
    </div>
  );
}
