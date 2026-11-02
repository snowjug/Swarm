import { Fragment } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { Info, Lock, PenLine, Sparkles, TriangleAlert, Unlock } from 'lucide-react';
import {
  SECTION_ORIGIN_LABELS,
  type StudioSectionView,
  type StudioView,
} from '../../../../shared/studio';
import { cx } from '../../design/cx';
import { Button, Chip, ChipButton, IconButton, Segmented } from '../../design/ui';
import { actorLabel } from '../../lib/studio';
import { Citations } from '../report/Citations';
import type { StudioActions } from './actions';
import { Diff } from './Diff';
import { Editor } from './Editor';
import { ORIGIN_ICONS } from './glyphs';
import {
  FROZEN_LABEL,
  checkDraft,
  draftState,
  plural,
  provenanceNote,
  sectionKicker,
  type Draft,
  type Frozen,
  type SectionAccess,
  type ToolId,
} from './model';
import { Prose } from './Prose';
import './Page.css';

export type ProposalMode = 'changes' | 'rewrite' | 'current';

/** The text a rewrite would put in the place of this one: the changes, the new text, or the text as it stands. */
function ProposalPane({
  section,
  mode,
  onMode,
}: {
  section: StudioSectionView;
  mode: ProposalMode;
  onMode: (mode: ProposalMode) => void;
}) {
  const { proposal } = section;
  if (!proposal) return null;
  return (
    <div className="sw-proposal">
      <div className="sw-proposal__head">
        <p className="sw-proposal__kicker">
          <Sparkles size={15} aria-hidden="true" /> A rewrite is waiting for your decision
        </p>
        <Segmented
          size="sm"
          label="What to show"
          value={mode}
          onChange={onMode}
          options={[
            { value: 'changes', label: 'Changes' },
            { value: 'rewrite', label: 'Rewrite' },
            { value: 'current', label: 'Current' },
          ]}
        />
      </div>
      {mode === 'changes' ? (
        <Diff before={section.body} after={proposal.body} />
      ) : (
        <Prose body={mode === 'rewrite' ? proposal.body : section.body} />
      )}
    </div>
  );
}

/** An earlier version read against the text as it is now. */
function ComparePane({
  section,
  version,
  onClose,
}: {
  section: StudioSectionView;
  version: number;
  onClose: () => void;
}) {
  const entry = section.versions.find((candidate) => candidate.version === version);
  if (!entry) return null;
  return (
    <div className="sw-compare">
      <div className="sw-compare__head">
        <p>
          <span className="num">Version {entry.version}</span> read against the text now (
          <span className="num">version {section.version}</span>)
        </p>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Stop comparing
        </Button>
      </div>
      <Diff before={entry.body} after={section.body} />
    </div>
  );
}

/**
 * One section of the report as a page: what it is, who wrote it, its text, and, where the person may change it,
 * the means to. The text is what the eye lands on; everything else is the width of a line.
 */
export function SectionPage({
  view,
  section,
  position,
  access,
  frozen,
  draft,
  autoFocusEditor,
  comparing,
  proposalMode,
  actions,
  onEdit,
  onDraft,
  onSave,
  onDiscard,
  onCompare,
  onProposalMode,
  onTool,
}: {
  view: StudioView;
  section: StudioSectionView;
  position: { index: number; total: number };
  access: SectionAccess;
  frozen: Frozen | null;
  draft: Draft | undefined;
  autoFocusEditor: boolean;
  comparing: number | null;
  proposalMode: ProposalMode;
  actions: StudioActions;
  onEdit: () => void;
  onDraft: (next: Draft) => void;
  onSave: () => void;
  onDiscard: () => void;
  onCompare: (version: number | null) => void;
  onProposalMode: (mode: ProposalMode) => void;
  onTool: (tool: ToolId) => void;
}) {
  const OriginIcon = ORIGIN_ICONS[section.origin];
  const locked = section.locked !== null;
  const state = draftState(draft, section);
  const mode = section.proposal
    ? 'proposal'
    : draft
      ? 'edit'
      : comparing !== null
        ? 'compare'
        : 'read';
  const note = provenanceNote(section);
  const kicker = sectionKicker(section);
  const earlier = section.statements.length > 0 && !section.statementsCurrent;
  const chapter = section.kind === 'chapter';
  const counts: { tool: ToolId; label: string }[] = [
    ...(chapter && section.statements.length > 0
      ? [{ tool: 'statements' as const, label: plural(section.statements.length, 'statement') }]
      : []),
    ...(section.notes.length > 0
      ? [{ tool: 'notes' as const, label: plural(section.notes.length, 'note') }]
      : []),
    ...(section.versions.length > 1
      ? [{ tool: 'history' as const, label: plural(section.versions.length, 'version') }]
      : []),
  ];
  const idle = actions.pending === null;
  const titleId = `studio-section-${section.id}`;

  return (
    <article className="sw-page" aria-labelledby={titleId}>
      <header className="sw-page__head">
        <div className="sw-page__top">
          <p className="sw-page__kicker">
            {kicker && (
              <>
                <span>{kicker}</span>
                <span className="sw-page__sep" aria-hidden="true" />
              </>
            )}
            <span key={section.version} className="sw-page__version num">
              Version {section.version}
            </span>
          </p>
          {access.editable ? (
            <div className="sw-page__actions">
              {mode !== 'edit' && (
                <Button
                  size="sm"
                  variant="glass"
                  icon={<PenLine size={15} aria-hidden="true" />}
                  disabled={!access.canWrite || !idle}
                  onClick={onEdit}
                >
                  Edit
                </Button>
              )}
              <IconButton
                label={locked ? 'Unlock this section' : 'Lock this section as final wording'}
                pressed={locked}
                disabled={!idle || section.proposal !== null}
                onClick={() => void actions.lock(section, !locked)}
              >
                {locked ? (
                  <Lock size={17} aria-hidden="true" />
                ) : (
                  <Unlock size={17} aria-hidden="true" />
                )}
              </IconButton>
            </div>
          ) : (
            frozen && (
              <p className="sw-page__frozen">
                <Lock size={14} aria-hidden="true" /> {FROZEN_LABEL[frozen.kind]}
                <span className="sr-only">. {frozen.text}</span>
              </p>
            )
          )}
        </div>
        <h2 className="sw-page__title sw-title" id={titleId}>
          {section.title}
        </h2>
        <ul className="sw-page__chips" role="list">
          <li>
            <Chip
              size="sm"
              tone={
                section.origin === 'generated'
                  ? 'neutral'
                  : section.origin === 'human'
                    ? 'accent'
                    : 'caution'
              }
              icon={<OriginIcon aria-hidden="true" />}
            >
              {SECTION_ORIGIN_LABELS[section.origin]}
            </Chip>
          </li>
          {section.locked && (
            <li>
              <Chip size="sm" icon={<Lock aria-hidden="true" />}>
                Locked by {actorLabel(section.locked.actor)}
              </Chip>
            </li>
          )}
          {section.proposal && (
            <li>
              <ChipButton
                size="sm"
                tone="accent"
                icon={<Sparkles aria-hidden="true" />}
                onClick={() => onTool('rewrite')}
              >
                Rewrite waiting
              </ChipButton>
            </li>
          )}
          {earlier && (
            <li>
              <ChipButton
                size="sm"
                tone="caution"
                icon={<TriangleAlert aria-hidden="true" />}
                onClick={() => onTool('statements')}
              >
                Statements describe an earlier text
              </ChipButton>
            </li>
          )}
        </ul>
        {counts.length > 0 && (
          <p className="sw-page__counts">
            {counts.map((count, index) => (
              <Fragment key={count.tool}>
                {index > 0 && <span aria-hidden="true">·</span>}
                <button type="button" onClick={() => onTool(count.tool)}>
                  {count.label}
                </button>
              </Fragment>
            ))}
          </p>
        )}
      </header>

      <div className="sw-page__body">
        <AnimatePresence mode="wait" initial={false}>
          <m.div
            key={mode}
            className={cx('sw-page__pane', `sw-page__pane--${mode}`)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            {mode === 'proposal' && (
              <ProposalPane section={section} mode={proposalMode} onMode={onProposalMode} />
            )}
            {mode === 'edit' && draft && (
              <Editor
                section={section}
                draft={draft}
                state={state}
                maxBody={view.limits.maxBody}
                readOnly={!access.editable}
                autoFocus={autoFocusEditor}
                list={section.kind === 'limitations'}
                onChange={(text) => onDraft({ ...draft, text })}
                onSave={() => {
                  if (checkDraft(draft, section, view.limits).ok && access.editable) onSave();
                }}
                onDiscard={onDiscard}
              />
            )}
            {mode === 'compare' && comparing !== null && (
              <ComparePane section={section} version={comparing} onClose={() => onCompare(null)} />
            )}
            {mode === 'read' && <Prose body={section.body} list={section.kind === 'limitations'} />}
          </m.div>
        </AnimatePresence>

        {mode === 'read' && chapter && (
          <Citations
            sourceIds={section.citations.sourceIds}
            memoryIds={section.citations.memoryIds}
            interviewIds={section.citations.interviewIds}
          />
        )}
        {note && mode !== 'edit' && (
          <p className="sw-page__note">
            <Info size={14} aria-hidden="true" /> {note}
          </p>
        )}
      </div>
      <p className="sr-only">
        Section {position.index + 1} of {position.total}.
      </p>
    </article>
  );
}
