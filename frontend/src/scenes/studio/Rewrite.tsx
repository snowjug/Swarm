import { Sparkles } from 'lucide-react';
import { SUPPORT_VERDICTS, SUPPORT_VERDICT_LABELS } from '../../../../shared/grounding';
import type { StudioProposal, StudioSectionView, StudioView } from '../../../../shared/studio';
import { Button, Disclosure, Notice, Orbit, Textarea } from '../../design/ui';
import { dateTime } from '../../lib/format';
import { actorLabel } from '../../lib/studio';
import { VERDICT_ICONS, VERDICT_TONES } from './glyphs';
import { plural, type SectionAccess } from './model';
import { StatementList } from './Statements';
import { TallyBar, type Tally } from './TallyBar';
import './Rewrite.css';

/** What the server found when it checked the model's new text the way the report was checked. */
function ProposalChecks({
  proposal,
  evidence,
}: {
  proposal: StudioProposal;
  evidence: Pick<StudioView, 'passages' | 'memories' | 'assumptions'>;
}) {
  const { grounding, usage } = proposal;
  const tallies: Tally[] = SUPPORT_VERDICTS.map((verdict) => ({
    key: verdict,
    label: SUPPORT_VERDICT_LABELS[verdict],
    count: grounding.counts[verdict],
    tone: VERDICT_TONES[verdict],
    icon: VERDICT_ICONS[verdict],
  }));
  const checked = tallies.reduce((sum, tally) => sum + tally.count, 0);
  return (
    <div className="sw-tool__stack">
      <div className="sw-rw__who">
        <p>
          Written by the model, requested by {actorLabel(proposal.actor)}, {dateTime(proposal.at)}.
        </p>
        {proposal.instruction && <p className="sw-rw__ask">“{proposal.instruction}”</p>}
        <p className="sw-caption num">
          {plural(usage.modelCalls, 'model call')} · {usage.inputTokens.toLocaleString('en-GB')}{' '}
          tokens in · {usage.outputTokens.toLocaleString('en-GB')} out
        </p>
      </div>

      <TallyBar
        tallies={tallies}
        label={`${plural(checked, 'statement')} of the rewrite, checked`}
      />
      <p className="sw-caption">
        Checked the way the report was:{' '}
        {grounding.method === 'deterministic+model'
          ? 'quotations, wording, figures and an independent model check.'
          : 'quotations, wording and figures only. The independent model check did not run.'}
      </p>

      {grounding.unverifiedFigures.length > 0 && (
        <Notice tone="caution" title="Figures that match nothing in the cited material">
          {grounding.unverifiedFigures.join(', ')}. They may be invented: do not accept the text
          without checking them.
        </Notice>
      )}
      {grounding.notes.length > 0 && (
        <ul className="sw-rw__notes" role="list">
          {grounding.notes.map((note, index) => (
            <li key={index}>{note}</li>
          ))}
        </ul>
      )}
      {proposal.statements.length > 0 && (
        <Disclosure summary={`Its ${plural(proposal.statements.length, 'statement')}`}>
          <StatementList statements={proposal.statements} evidence={evidence} />
        </Disclosure>
      )}
    </div>
  );
}

/**
 * Asking the model to write one chapter again, and, when it has, what it wrote and how it was checked. The
 * result is a proposal: it changes nothing until a person accepts it.
 */
export function Rewrite({
  view,
  section,
  access,
  instruction,
  onInstruction,
  pending,
  onWrite,
}: {
  view: StudioView;
  section: StudioSectionView;
  access: SectionAccess;
  instruction: string;
  onInstruction: (text: string) => void;
  pending: string | null;
  onWrite: () => void;
}) {
  const writing = pending === `regenerate:${section.id}`;
  if (section.proposal) {
    return <ProposalChecks proposal={section.proposal} evidence={view} />;
  }
  if (!view.regeneration.available) {
    return (
      <div className="sw-tool__stack">
        <Notice tone="info">
          {view.regeneration.reason ?? 'Writing a chapter again is not available for this report.'}
        </Notice>
      </div>
    );
  }
  if (!access.editable) {
    return (
      <p className="sw-tool__empty">Writing a chapter again needs a report that can be changed.</p>
    );
  }
  return (
    <form
      className="sw-tool__stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (access.canWrite && pending === null) onWrite();
      }}
    >
      <label className="sw-field__label" htmlFor={`rewrite-${section.id}`}>
        What to emphasise, or how to say it
      </label>
      <Textarea
        id={`rewrite-${section.id}`}
        maxRows={6}
        maxLength={view.limits.maxInstruction}
        value={instruction}
        placeholder="Optional"
        disabled={!access.canWrite || writing}
        onChange={(event) => onInstruction(event.target.value)}
      />
      {writing ? (
        <div className="sw-rw__busy" role="status">
          <Orbit size={22} label="Writing" />
          <p>Writing this chapter again from the same sources. This can take a little while.</p>
        </div>
      ) : (
        <div className="sw-rw__go">
          <Button
            type="submit"
            variant="glass"
            icon={<Sparkles size={16} aria-hidden="true" />}
            disabled={!access.canWrite || pending !== null}
          >
            Write it again
          </Button>
          <p className="sw-caption">
            {access.blocked ?? 'Nothing changes until you accept the result.'}
          </p>
        </div>
      )}
      <Disclosure summary="How a rewrite is checked">
        <p className="sw-caption sw-rw__how">
          The model writes the chapter again from the same sources and the server checks what it
          wrote the way it checked the report: quotations, wording, figures and, where a model is
          configured, an independent check. Your request asks for emphasis and wording; it cannot
          loosen the checks.
        </p>
      </Disclosure>
    </form>
  );
}
