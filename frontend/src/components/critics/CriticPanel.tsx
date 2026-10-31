import {
  Check,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Cpu,
  Info,
  ListChecks,
  MessageSquareReply,
  OctagonAlert,
  Scale,
  Search,
  TriangleAlert,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import {
  CRITIQUE_SEVERITIES,
  CRITIQUE_STATUSES,
  type Critique,
  type CritiqueResponseStatus,
  type CritiqueSet,
  type CritiqueSeverity,
  type CritiqueStatus,
  type CritiquesView,
} from '../../../../shared/critique';
import type { ProjectDetail } from '../../../../shared/types';
import { useCritiques, type CritiquesState } from '../../hooks/useCritiques';
import {
  ORIGIN_VIEW,
  RESPONSE_ACTIONS,
  SEVERITY_VIEW,
  STATUS_VIEW,
  day,
  groupByRole,
  impactHeading,
  isOutOfDate,
  modeText,
  summarise,
  targetLabel,
} from '../../lib/critics';
import { EmptyPanel, Notice, Spinner } from '../ui';

export interface CriticPanelProps {
  project: ProjectDetail;
}

const SEVERITY_ICON: Record<CritiqueSeverity, LucideIcon> = {
  blocking: OctagonAlert,
  major: TriangleAlert,
  minor: CircleAlert,
  note: Info,
};

const STATUS_ICON: Record<CritiqueStatus, LucideIcon> = {
  open: CircleHelp,
  responded: MessageSquareReply,
  accepted: CircleCheck,
  disputed: Scale,
};

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** A chip says its meaning in words and with a glyph of its own, so that colour is never the only cue. */
function Chip({
  className,
  icon: Icon,
  label,
  title,
}: {
  className: string;
  icon: LucideIcon;
  label: string;
  title: string;
}) {
  return (
    <span className={`critic-chip ${className}`} title={title}>
      <Icon size={13} aria-hidden="true" />
      {label}
    </span>
  );
}

const SeverityChip = ({ severity }: { severity: CritiqueSeverity }) => (
  <Chip
    className={`critic-chip-${severity}`}
    icon={SEVERITY_ICON[severity]}
    label={SEVERITY_VIEW[severity].label}
    title={SEVERITY_VIEW[severity].meaning}
  />
);

const StatusChip = ({ status }: { status: CritiqueStatus }) => (
  <Chip
    className={`critic-chip-status-${status}`}
    icon={STATUS_ICON[status]}
    label={STATUS_VIEW[status].label}
    title={STATUS_VIEW[status].meaning}
  />
);

/** What a person says to one critique: the words, what is still disputed, and what the answer means. */
function ResponseForm({ critique, state }: { critique: Critique; state: CritiquesState }) {
  const id = useId();
  const [text, setText] = useState(critique.response?.text ?? '');
  const [remaining, setRemaining] = useState(critique.remainingDisagreement ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const busy = state.answering === critique.id;
  const failure =
    problem ?? (state.answerError?.id === critique.id ? state.answerError.message : null);

  const answer = async (status: CritiqueResponseStatus) => {
    if (text.trim() === '') {
      setProblem('Write your response before choosing what it means.');
      return;
    }
    setProblem(null);
    await state.respond(critique.id, {
      text: text.trim(),
      status,
      remainingDisagreement: remaining.trim() === '' ? null : remaining.trim(),
    });
  };

  return (
    <details className="critic-answer">
      <summary>{critique.response ? 'Change your response' : 'Respond to this criticism'}</summary>
      <form
        className="critic-form"
        noValidate
        aria-label={`Respond to: ${targetLabel(critique.target)}`}
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="field">
          <label htmlFor={`${id}-text`}>Your response</label>
          <textarea
            id={`${id}-text`}
            rows={3}
            maxLength={800}
            value={text}
            disabled={busy}
            onChange={(event) => {
              setText(event.target.value);
              setProblem(null);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor={`${id}-remaining`}>What you still disagree about (optional)</label>
          <textarea
            id={`${id}-remaining`}
            rows={2}
            maxLength={600}
            value={remaining}
            disabled={busy}
            onChange={(event) => setRemaining(event.target.value)}
          />
        </div>
        <div aria-live="polite">
          {failure && (
            <Notice tone="error" title="Your response was not saved">
              {failure}
            </Notice>
          )}
        </div>
        <div className="critic-actions" role="group" aria-label="What your response means">
          {RESPONSE_ACTIONS.map((action) => (
            <button
              key={action.status}
              className="button button-secondary button-small"
              type="button"
              disabled={busy}
              onClick={() => void answer(action.status)}
            >
              {action.label}
            </button>
          ))}
          {busy && <Spinner label="Saving your response" />}
        </div>
        <p className="field-help">
          Respond answers the criticism without settling it. Accept means the objection stands and
          its impact applies to the conclusion. Dispute keeps the disagreement in view, with what
          you still disagree about.
        </p>
      </form>
    </details>
  );
}

/** One criticism: what it says, what it rests on, what it does to the conclusion, and the answer to it. */
function CritiqueCard({
  critique,
  state,
  canRespond,
}: {
  critique: Critique;
  state: CritiquesState;
  canRespond: boolean;
}) {
  const titleId = useId();
  const origin = ORIGIN_VIEW[critique.origin];
  return (
    <article className={`critic-card critic-${critique.severity}`} aria-labelledby={titleId}>
      <header className="critic-card-head">
        <h4 id={titleId}>{targetLabel(critique.target)}</h4>
        <div className="critic-chips">
          <SeverityChip severity={critique.severity} />
          <Chip
            className="critic-chip-origin"
            icon={critique.origin === 'rules' ? ListChecks : Cpu}
            label={origin.label}
            title={origin.meaning}
          />
          <StatusChip status={critique.status} />
        </div>
      </header>
      <p className="critic-objection">{critique.objection}</p>
      <dl className="critic-facts">
        {critique.basis.length > 0 && (
          <div>
            <dt>What it rests on</dt>
            <dd>
              <ul className="critic-basis">
                {critique.basis.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        {critique.evidence.length > 0 && (
          <div>
            <dt>Evidence</dt>
            <dd>
              <ul className="critic-evidence">
                {critique.evidence.map((passage) => (
                  <li key={`${passage.passageId}-${passage.role}`}>
                    <span className="mono">
                      {passage.documentName}, passage {passage.passageId}
                      {passage.role === 'contradicts' ? ' (contradicts)' : ''}
                    </span>
                    {passage.quote && (
                      <blockquote className="critic-quote">{passage.quote}</blockquote>
                    )}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        <div className={`critic-impact critic-impact-${critique.status}`}>
          <dt>{impactHeading(critique.status)}</dt>
          <dd>{critique.impactOnConclusion || 'No effect on the conclusion was stated.'}</dd>
        </div>
        {critique.response && (
          <div className="critic-response">
            <dt>
              {critique.response.by === 'user' ? 'Response' : 'Response by the analysis'},{' '}
              {day(critique.response.at)}
            </dt>
            <dd className="preserve-text">{critique.response.text}</dd>
          </div>
        )}
        {(critique.remainingDisagreement || critique.status === 'disputed') && (
          <div className="critic-remaining">
            <dt>Still disputed</dt>
            <dd className="preserve-text">
              {critique.remainingDisagreement ?? 'No reason for the dispute was given.'}
            </dd>
          </div>
        )}
      </dl>
      {canRespond && (
        <ResponseForm
          key={`${critique.id}:${critique.response?.at ?? ''}`}
          critique={critique}
          state={state}
        />
      )}
    </article>
  );
}

/** How many criticisms of each severity and in each status, so that what is still open is plain. */
function Summary({ set }: { set: CritiqueSet }) {
  const summary = summarise(set.critiques);
  return (
    <section className="critic-summary" aria-label="Summary of the independent review">
      <h3>What the review found</h3>
      <p>
        {summary.total === 0
          ? 'The checks raised no criticism. That does not show that the analysis is right: they look only for the faults described under each critic.'
          : `${count(summary.total, 'criticism')} raised against this analysis. A criticism is a challenge, not a verdict, and none of them has changed a finding.`}
      </p>
      <p className="critic-meta">
        {modeText(set.mode)}. Made {day(set.generatedAt)}
        {set.analysisId ? ` for analysis ${set.analysisId}` : ''}.
      </p>
      <ul className="critic-counts" aria-label="Criticisms by severity">
        {[...CRITIQUE_SEVERITIES].reverse().map((severity) => (
          <li key={severity}>
            <SeverityChip severity={severity} />
            <strong>{summary.bySeverity[severity]}</strong>
          </li>
        ))}
      </ul>
      <ul className="critic-counts" aria-label="Criticisms by status">
        {CRITIQUE_STATUSES.map((status) => (
          <li key={status}>
            <StatusChip status={status} />
            <strong>{summary.byStatus[status]}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Asks for a review, and says what each kind of review is. */
function RunControls({ view, state }: { view: CritiquesView; state: CritiquesState }) {
  const id = useId();
  const [useModel, setUseModel] = useState(false);
  const { running, runError } = state;
  const again = view.critiques !== null;
  return (
    <section className="critic-run" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>{again ? 'Run the review again' : 'Run an independent review'}</h3>
      <p>
        The <strong>deterministic checks</strong> always run. They read the scenario, the
        stakeholders, the cast and the analysis, and the decision brief when there is one, and apply
        fixed rules, so the same input always gives the same criticisms. No model is involved.
      </p>
      <p>
        The optional <strong>model review</strong> sends a compact digest to the configured model,
        which may add criticisms. Anything it says about an id that does not exist is dropped, it
        cannot change a finding, and if it fails you still get the deterministic checks, with a note
        that says so.
      </p>
      <div className="critic-check">
        <input
          id={`${id}-model`}
          type="checkbox"
          checked={useModel && view.model.available}
          disabled={!view.model.available || running || !view.may.run}
          onChange={(event) => setUseModel(event.target.checked)}
        />
        <label htmlFor={`${id}-model`}>Also ask the model for a deeper review</label>
      </div>
      {!view.model.available && (
        <p className="field-help">
          No model is configured, so only the deterministic checks can run.
        </p>
      )}
      <div className="stage-actions">
        <button
          className="button button-primary"
          type="button"
          disabled={running || !view.may.run}
          onClick={() => void state.run(useModel && view.model.available)}
        >
          {running ? (
            <Spinner label="Running the independent review" />
          ) : (
            <Search size={16} aria-hidden="true" />
          )}
          {again ? 'Run independent review again' : 'Run independent review'}
        </button>
      </div>
      {!view.may.run && (
        <p className="field-help">
          Only someone who can run analyses on this experiment can start a review.
        </p>
      )}
      {again && (
        <p className="field-help">
          Your responses are kept for any criticism that comes back unchanged. A criticism that no
          longer applies is dropped with its response.
        </p>
      )}
      {runError && (
        <Notice tone="error" title="The independent review did not run">
          {runError}
        </Notice>
      )}
    </section>
  );
}

/** The independent review: criticisms by critic, each with its basis, its impact and the answer to it. */
export function CriticReview({ state }: { state: CritiquesState }) {
  const headingId = useId();
  const { view, loading, error, reload } = state;

  let body: ReactNode;
  if (!view) {
    body = error ? (
      <Notice
        tone="error"
        title="The independent review could not be read"
        action={
          <button className="button button-secondary button-small" type="button" onClick={reload}>
            Retry
          </button>
        }
      >
        {error}
      </Notice>
    ) : (
      <div className="inline-pending" role="status">
        <Spinner label="Loading the independent review" />
        {loading ? ' Reading the independent review…' : ''}
      </div>
    );
  } else {
    const set = view.critiques;
    body = (
      <>
        {isOutOfDate(view) && (
          <Notice tone="warning" title="This review is of an earlier analysis">
            A newer analysis has finished since. Run the review again to challenge it; responses to
            criticisms that come back unchanged are kept.
          </Notice>
        )}
        {set?.notes && set.notes.length > 0 && (
          <Notice tone="info" title="About how this review was made">
            {set.notes.join('\n')}
          </Notice>
        )}
        {view.analysis ? (
          <RunControls view={view} state={state} />
        ) : (
          <EmptyPanel
            title="There is no finished analysis to review yet"
            icon={<Search size={25} aria-hidden="true" />}
          >
            Compare scenarios first. The independent review challenges the findings of a finished
            analysis, and it asks for nothing until there is one.
          </EmptyPanel>
        )}
        {set ? (
          <>
            <Summary set={set} />
            {groupByRole(set.critiques).map((group) => (
              <section
                key={group.role}
                className="critic-group"
                aria-labelledby={`${headingId}-${group.role}`}
              >
                <header className="critic-group-head">
                  <span className="eyebrow">{group.label}</span>
                  <h3 id={`${headingId}-${group.role}`}>{group.question}</h3>
                  <span className="critic-group-count">
                    {count(group.critiques.length, 'criticism')}
                  </span>
                </header>
                <ul className="critic-list">
                  {group.critiques.map((critique) => (
                    <li key={critique.id}>
                      <CritiqueCard
                        critique={critique}
                        state={state}
                        canRespond={view.may.respond}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {!view.may.respond && set.critiques.length > 0 && (
              <p className="field-help">
                <Check size={13} aria-hidden="true" /> Only someone who can edit this experiment can
                respond to a criticism.
              </p>
            )}
          </>
        ) : (
          view.analysis && (
            <EmptyPanel
              title="No independent review yet"
              icon={<Search size={25} aria-hidden="true" />}
            >
              Nobody has run the review for this experiment. Nothing is shown until it has been run.
            </EmptyPanel>
          )
        )}
      </>
    );
  }

  return (
    <section className="critic-panel view-stack" aria-labelledby={headingId}>
      <header className="critic-head">
        <span className="eyebrow">Challenge</span>
        <h2 id={headingId}>Independent review</h2>
        <p className="critic-intro">
          Critics challenge the analysis and never change it. Each criticism shows what it rests on,
          what you answered, what is still disputed and what it does to the conclusion if it stands.
          Swarm explores scenarios; it does not guarantee or precisely predict real-world behaviour.
        </p>
      </header>
      {body}
    </section>
  );
}

/** Independent challenges to the analysis, with responses. */
export function CriticPanel({ project }: CriticPanelProps) {
  const state = useCritiques(project.id);
  return <CriticReview state={state} />;
}
