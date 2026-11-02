import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { ArrowUpRight, History } from 'lucide-react';
import type { StudioView } from '../../../../shared/studio';
import { SPRING, useReducedMotion } from '../../design/motion';
import { Button, Notice } from '../../design/ui';
import type { StudioHandle } from '../../hooks/useStudio';
import { dateTime } from '../../lib/format';
import { actorLabel, diffCounts, diffWords } from '../../lib/studio';
import { EditBar, ProposalBar } from './ActionBar';
import type { StepKind, StudioActions } from './actions';
import { Dialogs, type DialogKind } from './Dialogs';
import { ExportMenu } from './ExportMenu';
import { StudioHeader } from './Header';
import { MoreMenu } from './MoreMenu';
import {
  checkDraft,
  draftState,
  frozenReason,
  isDirty,
  rebase,
  sectionAccess,
  startDraft,
  toolsOf,
  type Draft,
  type StudioDocument,
  type ToolId,
} from './model';
import { Outline, SectionSwitcher } from './Outline';
import { SectionPage, type ProposalMode } from './Page';
import { RecordSheet } from './Record';
import { Tools } from './Tools';
import { Workflow } from './Workflow';
import './Workbench.css';

/**
 * The studio when there is a document: the sections along the left, the one in view as a page in the middle,
 * what can be done with it at the right, and the review of the whole report above. What a person is writing
 * is kept while they read another section, and a bar floats at the foot of the screen while a decision is
 * in front of them.
 */
export function Workbench({
  projectId,
  view,
  document,
  studio,
  actions,
  onBack,
  onReport,
  onAudit,
}: {
  projectId: string;
  view: StudioView;
  document: StudioDocument;
  studio: StudioHandle;
  actions: StudioActions;
  onBack: () => void;
  onReport: (() => void) | null;
  onAudit: () => void;
}) {
  const reduced = useReducedMotion();
  const sections = document.sections;
  const [selectedId, setSelectedId] = useState<string>(() => sections[0]?.id ?? '');
  const section = sections.find((candidate) => candidate.id === selectedId) ?? sections[0];
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [focusEditor, setFocusEditor] = useState(false);
  const [tool, setTool] = useState<ToolId>('statements');
  const [comparing, setComparing] = useState<{ sectionId: string; version: number } | null>(null);
  const [proposalMode, setProposalMode] = useState<ProposalMode>('changes');
  const [instructions, setInstructions] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const direction = useRef<1 | -1>(1);
  const pageRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLElement>(null);

  // Words that nobody has changed follow the section; words that have been written stay as they are, and
  // a draft of a section that is gone has nothing left to be a draft of.
  useEffect(() => {
    setDrafts((current) => {
      let changed = false;
      const next: Record<string, Draft> = {};
      for (const [id, draft] of Object.entries(current)) {
        const target = sections.find((candidate) => candidate.id === id);
        if (!target) {
          changed = true;
          continue;
        }
        const moved = rebase(draft, target);
        if (moved !== draft) changed = true;
        next[id] = moved;
      }
      return changed ? next : current;
    });
  }, [sections]);

  const unsaved = useMemo(
    () => Object.values(drafts).filter((draft) => isDirty(draft)).length,
    [drafts],
  );
  useEffect(() => {
    if (unsaved === 0) return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  const proposalId = section?.proposal?.id ?? null;
  useEffect(() => {
    setProposalMode('changes');
    if (proposalId) setTool('rewrite');
  }, [proposalId, selectedId]);

  const access = useMemo(
    () =>
      section
        ? sectionAccess(view, document, section)
        : { editable: false, canWrite: false, blocked: null },
    [view, document, section],
  );
  const frozen = useMemo(() => frozenReason(view, document), [view, document]);
  // What the reviewer who sent the report back said: it is the first thing the author needs.
  const sentBack = useMemo(
    () =>
      document.state === 'changes-requested'
        ? ([...document.decisions]
            .reverse()
            .find((entry) => entry.action === 'changes-requested') ?? null)
        : null,
    [document],
  );
  const proposalCounts = useMemo(
    () => (section?.proposal ? diffCounts(diffWords(section.body, section.proposal.body)) : null),
    [section],
  );

  const scrollTo = useCallback(
    (node: HTMLElement | null) => {
      if (!node) return;
      if (
        node.getBoundingClientRect().top < 0 ||
        node.getBoundingClientRect().top > window.innerHeight * 0.8
      ) {
        node.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
      }
    },
    [reduced],
  );

  const select = useCallback(
    (id: string) => {
      const from = sections.findIndex((candidate) => candidate.id === selectedId);
      const to = sections.findIndex((candidate) => candidate.id === id);
      direction.current = to >= from ? 1 : -1;
      setSelectedId(id);
      setFocusEditor(false);
      scrollTo(pageRef.current);
    },
    [scrollTo, sections, selectedId],
  );

  const openTool = useCallback(
    (next: ToolId) => {
      setTool(next);
      scrollTo(toolsRef.current);
    },
    [scrollTo],
  );

  if (!section) return null;
  const draft = drafts[section.id];
  const state = draftState(draft, section);
  const position = { index: sections.indexOf(section), total: sections.length };
  const check = draft ? checkDraft(draft, section, view.limits) : null;
  const saving = actions.pending === `edit:${section.id}`;
  const editing = draft !== undefined && !section.proposal;
  const deciding =
    actions.pending === `proposal:${section.id}:accept`
      ? 'accept'
      : actions.pending === `proposal:${section.id}:reject`
        ? 'reject'
        : null;

  const setDraft = (next: Draft | undefined) =>
    setDrafts((current) => {
      const copy = { ...current };
      if (next) copy[section.id] = next;
      else delete copy[section.id];
      return copy;
    });
  const save = () => {
    if (!draft || saving) return;
    void actions.edit(section, draft.text, draft.reason.trim() || null).then((made) => {
      if (made) setDraft(undefined);
    });
  };
  const step = (kind: StepKind) => {
    if (kind === 'submit') void actions.step('submit', null);
    else if (kind === 'approve') setDialog('approve');
    else if (kind === 'request-changes') setDialog('request-changes');
    else setDialog(document.state === 'approved' ? 'reopen' : 'withdraw');
  };
  const back = () => (unsaved > 0 ? setDialog('leave') : onBack());

  return (
    <>
      <StudioHeader
        title={view.report?.title ?? 'Report'}
        onBack={back}
        tools={
          <>
            {onReport && (
              <Button
                variant="ghost"
                size="sm"
                iconEnd={<ArrowUpRight size={15} aria-hidden="true" />}
                onClick={onReport}
              >
                Detailed report
              </Button>
            )}
            <Button
              variant="glass"
              size="sm"
              icon={<History size={15} aria-hidden="true" />}
              onClick={() => setRecordOpen(true)}
            >
              Record
            </Button>
            {view.capabilities.export && (
              <ExportMenu
                projectId={projectId}
                busy={actions.exporting}
                disabled={actions.pending !== null}
                onExport={(format) => void actions.exportAs(format)}
              />
            )}
          </>
        }
        menu={
          <MoreMenu
            projectId={projectId}
            canExport={view.capabilities.export}
            onReport={onReport}
            onRecord={() => setRecordOpen(true)}
            onExport={(format) => void actions.exportAs(format)}
          />
        }
      />

      <Workflow view={view} document={document} pending={actions.pending} onStep={step} />

      <div className="sw-studio__notices">
        {frozen?.kind === 'stale' && (
          <Notice
            tone="caution"
            title="The generated report was replaced after this copy was made"
            action={
              frozen.action === 'restart' ? (
                <Button
                  size="sm"
                  variant="glass"
                  busy={actions.pending === 'start'}
                  disabled={actions.pending !== null}
                  onClick={() => void actions.start(false, () => setDialog('restart'))}
                >
                  Start again from the new report
                </Button>
              ) : undefined
            }
          >
            It can still be read and exported, but not changed. Starting again makes a new copy from
            the new report and keeps the text of this one in an archive.
          </Notice>
        )}
        {frozen?.kind === 'read-only' && <Notice tone="info">{frozen.text}</Notice>}
        {sentBack && (
          <Notice tone="caution" title="A reviewer sent it back for changes">
            <div className="sw-sentback">
              {sentBack.note && <p className="sw-sentback__note">{sentBack.note}</p>}
              <p className="sw-caption">
                {actorLabel(sentBack.actor)} · {dateTime(sentBack.at)}
              </p>
            </div>
          </Notice>
        )}
        {studio.actionError && (
          <Notice
            tone="error"
            title="That change was not made"
            action={
              <Button size="sm" variant="glass" onClick={studio.clearActionError}>
                Dismiss
              </Button>
            }
          >
            {studio.actionError}
            {unsaved > 0 && ' What you wrote is kept.'}
          </Notice>
        )}
      </div>

      <div className="sw-benchwrap">
        <div className="sw-bench__switch">
          <SectionSwitcher
            sections={sections}
            selectedId={section.id}
            onSelect={select}
            drafts={drafts}
          />
        </div>
        <div className="sw-bench">
          <div className="sw-bench__outline">
            <Outline
              sections={sections}
              selectedId={section.id}
              onSelect={select}
              drafts={drafts}
            />
          </div>

          <div className="sw-bench__page" ref={pageRef}>
            <AnimatePresence mode="wait" initial={false}>
              <m.div
                key={section.id}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 * direction.current }}
                animate={{ opacity: 1, y: 0, transition: SPRING.smooth }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
              >
                <SectionPage
                  view={view}
                  section={section}
                  position={position}
                  access={access}
                  frozen={frozen}
                  draft={draft}
                  autoFocusEditor={focusEditor}
                  comparing={comparing?.sectionId === section.id ? comparing.version : null}
                  proposalMode={proposalMode}
                  actions={actions}
                  onEdit={() => {
                    setDraft(startDraft(section));
                    setFocusEditor(true);
                  }}
                  onDraft={setDraft}
                  onSave={save}
                  onDiscard={() => setDraft(undefined)}
                  onCompare={(version) =>
                    setComparing(version === null ? null : { sectionId: section.id, version })
                  }
                  onProposalMode={setProposalMode}
                  onTool={openTool}
                />
              </m.div>
            </AnimatePresence>
          </div>

          <aside className="sw-bench__tools" ref={toolsRef} aria-label="Tools for this section">
            <AnimatePresence mode="wait" initial={false}>
              <m.div
                key={section.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.22 } }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
              >
                <Tools
                  view={view}
                  section={section}
                  access={access}
                  actions={actions}
                  tool={toolsOf(section).includes(tool) ? tool : (toolsOf(section)[0] ?? 'notes')}
                  onTool={setTool}
                  comparing={comparing?.sectionId === section.id ? comparing.version : null}
                  onCompare={(version) =>
                    setComparing(version === null ? null : { sectionId: section.id, version })
                  }
                  instruction={instructions[section.id] ?? ''}
                  onInstruction={(text) =>
                    setInstructions((current) => ({ ...current, [section.id]: text }))
                  }
                />
              </m.div>
            </AnimatePresence>
          </aside>
        </div>
      </div>

      <AnimatePresence>
        {editing && draft && check && (
          <EditBar
            key="edit"
            nextVersion={section.version + 1}
            state={state === 'none' ? 'clean' : state}
            reason={draft.reason}
            problem={state !== 'clean' && !check.ok ? check.reason : null}
            saving={saving}
            blocked={!access.editable}
            onReason={(reason) => setDraft({ ...draft, reason })}
            onSave={save}
            onDiscard={() => setDraft(undefined)}
          />
        )}
        {section.proposal && access.editable && (
          <ProposalBar
            key="proposal"
            summary={
              proposalCounts ? (
                <span className="num">
                  Rewrite: +{proposalCounts.added} −{proposalCounts.removed} words
                </span>
              ) : (
                'A rewrite is waiting'
              )
            }
            deciding={deciding}
            onReject={() => void actions.decide(section, 'reject')}
            onAccept={() => void actions.decide(section, 'accept')}
          />
        )}
      </AnimatePresence>

      <Dialogs
        kind={dialog}
        view={view}
        state={document.state}
        working={actions.pending}
        unsaved={unsaved}
        onClose={() => setDialog(null)}
        onStep={(kind, note) =>
          void actions.step(kind, note).then((made) => made && setDialog(null))
        }
        onRestart={() => void actions.start(true).then((made) => made && setDialog(null))}
        onLeave={() => {
          setDialog(null);
          onBack();
        }}
      />
      <RecordSheet
        view={view}
        document={document}
        open={recordOpen}
        onOpenChange={setRecordOpen}
        onAudit={onAudit}
      />
    </>
  );
}
