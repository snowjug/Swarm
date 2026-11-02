import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BriefExportFormat, BriefView, DecisionBrief } from '../../../../shared/brief';
import type { CriticRole } from '../../../../shared/critique';
import type { ProjectDetail } from '../../../../shared/types';
import { Button, Notice, Orbit, Sheet, SheetContent, useToast } from '../../design/ui';
import { useReducedMotion } from '../../design/motion';
import type { BriefHandle } from '../../hooks/useBrief';
import type { CritiquesState } from '../../hooks/useCritiques';
import { briefApi } from '../../api/brief';
import type { UiMode } from '../../lib/mode';
import { POSITIONING_STATEMENT } from '../../lib/product';
import { ChapterBody } from './Chapters';
import {
  keepInPlace,
  usePassed,
  usePinned,
  useScrollProgress,
  useScrollSpy,
  type BriefAnalysis,
} from './hooks';
import {
  ACTS,
  ANSWER_ANCHOR,
  anchorOf,
  CHAPTERS_ANCHOR,
  chapterFromHash,
  chaptersOf,
  deriveHero,
  freshnessOf,
  gistOf,
  type Chapter,
  type ChapterId,
} from './model/brief-model';
import { anchorCritiques, reviewHeadline, tally } from './model/critique-model';
import { plural } from './model/format';
import { reportTool } from './model/report-tool';
import { ReviewChapter } from './review/Review';
import { ReviewSheet } from './review/ReviewSheet';
import { ActDivider, ChapterShell } from './ui/Chapter';
import { DocContext, type DocContextValue } from './ui/context';
import { Hero } from './ui/Hero';
import { ContentsList, ContentsRail, DocBar, type Place } from './ui/Nav';
import { smooth } from './ui/scroll';
import { Tools } from './ui/Tools';
import './document.css';
import './forced.css';

export interface DocumentProps {
  project: ProjectDetail;
  mode: UiMode;
  view: BriefView & { brief: DecisionBrief };
  handle: Pick<
    BriefHandle,
    'generating' | 'generateError' | 'generate' | 'reload' | 'error' | 'loading'
  >;
  review: CritiquesState;
  analysis: BriefAnalysis;
  reviewOpen: boolean;
  onReviewOpenChange: (open: boolean) => void;
  /** The brief is there because it was written a moment ago, on this page. */
  justWritten?: boolean;
  go: { simulate: () => void; studio: () => void; report: () => void; ground: () => void };
}

/**
 * The decision brief as a document: the answer first, then the story of it in four parts, with the
 * independent review beside it and in its place. A chapter of reference is closed until it is wanted; the
 * contents, the hash in the address and the tools all open a chapter before they take the reader to it.
 */
export function DecideDocument({
  project,
  mode,
  view,
  handle,
  review,
  analysis,
  reviewOpen,
  onReviewOpenChange,
  justWritten = false,
  go,
}: DocumentProps) {
  const { brief, visuals } = view;
  const toast = useToast();
  const reduced = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const heroTop = useRef<HTMLDivElement>(null);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [focus, setFocus] = useState<{ id: string | null; role: CriticRole | null }>({
    id: null,
    role: null,
  });
  const [arrival, setArrival] = useState(0);

  const chapters = useMemo(() => chaptersOf(brief), [brief]);
  const present = useMemo(() => chapters.map((chapter) => chapter.spec.id), [chapters]);
  const sections = useMemo(
    () => chapters.flatMap((chapter) => (chapter.section ? [chapter.section.id] : [])),
    [chapters],
  );
  const critiques = useMemo(() => review.view?.critiques?.critiques ?? [], [review.view]);
  const anchors = useMemo(
    () => anchorCritiques(brief, critiques, sections),
    [brief, critiques, sections],
  );
  const statementById = useMemo(
    () =>
      new Map(
        brief.sections.flatMap((section) =>
          section.statements.map((statement) => [statement.id, statement] as const),
        ),
      ),
    [brief],
  );
  const freshness = useMemo(() => freshnessOf(view), [view]);
  const hero = useMemo(() => deriveHero(brief, visuals), [brief, visuals]);
  const counts = useMemo(() => tally(critiques), [critiques]);
  const notes = useMemo(
    () => new Map([...anchors.bySection].map(([id, list]) => [id, list.length] as const)),
    [anchors],
  );

  // ---- Which chapters are open -----------------------------------------------------------------
  const [open, setOpen] = useState<ReadonlySet<ChapterId>>(
    () =>
      new Set(
        chapters
          .filter((chapter) => !chapter.spec.reference || mode === 'advanced')
          .map((chapter) => chapter.spec.id),
      ),
  );
  const references = useMemo(
    () => chapters.filter((chapter) => chapter.spec.reference),
    [chapters],
  );
  const allOpen = references.every((chapter) => open.has(chapter.spec.id));
  const toggle = useCallback((id: ChapterId) => {
    setOpen((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const openEvery = useCallback(() => {
    setOpen((old) => {
      const next = new Set(old);
      const everyOpen = references.every((chapter) => next.has(chapter.spec.id));
      for (const chapter of references) {
        if (everyOpen) next.delete(chapter.spec.id);
        else next.add(chapter.spec.id);
      }
      return next;
    });
  }, [references]);

  // ---- Going to a chapter ------------------------------------------------------------------------
  const [pinned, pin] = usePinned<Place>();
  const held = useRef<(() => void) | null>(null);
  useEffect(() => () => held.current?.(), []);
  const reveal = useCallback(
    (place: Place, options: { hash?: boolean } = {}) => {
      const id = place === 'answer' ? ANSWER_ANCHOR : anchorOf(place);
      if (place !== 'answer') setOpen((old) => (old.has(place) ? old : new Set(old).add(place)));
      pin(place);
      // The chapter is opened first and then reached: the page does not wait for it to finish growing,
      // since its top does not move while it does.
      requestAnimationFrame(() => {
        const target = document.getElementById(id);
        if (!target) return;
        target.scrollIntoView({ block: 'start', behavior: smooth(reduced) });
        target.focus({ preventScroll: true });
        if (options.hash !== false) window.history.replaceState(window.history.state, '', `#${id}`);
        held.current?.();
        if (root.current && typeof ResizeObserver !== 'undefined') {
          held.current = keepInPlace(target, root.current);
        }
      });
    },
    [reduced, pin],
  );

  const named = useRef(false);
  useEffect(() => {
    const fromAddress = () => {
      const place = chapterFromHash(window.location.hash, present);
      if (place) reveal(place, { hash: false });
    };
    if (!named.current) {
      named.current = true;
      fromAddress();
    }
    window.addEventListener('hashchange', fromAddress);
    return () => window.removeEventListener('hashchange', fromAddress);
  }, [present, reveal]);

  const active = useScrollSpy(useMemo(() => [ANSWER_ANCHOR, ...present.map(anchorOf)], [present]));
  const reading: Place | null =
    active === null
      ? null
      : active === ANSWER_ANCHOR
        ? 'answer'
        : (present.find((id) => anchorOf(id) === active) ?? null);
  const place = pinned ?? reading;
  const where = useMemo(() => {
    if (place === null || place === 'answer') return { act: null, title: 'The answer' };
    const chapter = chapters.find((entry) => entry.spec.id === place);
    return {
      act: chapter ? (ACTS.find((act) => act.id === chapter.spec.act)?.label ?? null) : null,
      title: chapter?.title ?? 'The answer',
    };
  }, [chapters, place]);

  useScrollProgress(root);
  const barShown = usePassed(heroTop);

  // ---- The review ---------------------------------------------------------------------------------------
  const openReview = useCallback(
    (target?: { id?: string; role?: CriticRole }) => {
      setFocus({ id: target?.id ?? null, role: target?.role ?? null });
      onReviewOpenChange(true);
    },
    [onReviewOpenChange],
  );
  const wasRunning = useRef(false);
  const { running, runError, view: reviewView } = review;
  useEffect(() => {
    if (wasRunning.current && !running && !runError) {
      setArrival((old) => old + 1);
      const raised = reviewView?.critiques?.critiques.length ?? 0;
      toast({
        title: 'The independent review is ready',
        description:
          raised === 0 ? 'The critics raised nothing.' : `${plural(raised, 'criticism')} raised.`,
        tone: 'success',
        duration: 4200,
      });
    }
    wasRunning.current = running;
  }, [running, runError, reviewView, toast]);

  // ---- The brief that was just written ----------------------------------------------------------------
  const announced = useRef(false);
  useEffect(() => {
    if (!justWritten || announced.current) return;
    announced.current = true;
    // The button that asked for it is gone: the reader's place is the answer.
    document.getElementById(ANSWER_ANCHOR)?.focus({ preventScroll: true });
    toast({
      title: 'The brief is ready',
      description: 'It was written from the newest comparison.',
      tone: 'success',
      duration: 4200,
    });
  }, [justWritten, toast]);

  // ---- Writing the brief again ----------------------------------------------------------------------
  const wasGenerating = useRef(false);
  const { generating, generateError } = handle;
  useEffect(() => {
    if (wasGenerating.current && !generating && !generateError) {
      window.scrollTo({ top: 0, behavior: smooth(reduced) });
      document.getElementById(ANSWER_ANCHOR)?.focus({ preventScroll: true });
      toast({
        title: 'The brief is up to date',
        description: 'It was written again from the newest comparison.',
        tone: 'success',
        duration: 4200,
      });
    }
    wasGenerating.current = generating;
  }, [generating, generateError, reduced, toast]);

  const url = useCallback(
    (format: BriefExportFormat) => briefApi.exportUrl(project.id, format),
    [project.id],
  );
  const generate = useCallback(() => void handle.generate(), [handle]);

  const context = useMemo<DocContextValue>(
    () => ({
      projectId: project.id,
      mode,
      brief,
      visuals,
      statementById,
      critiques,
      anchors,
      facts: analysis.facts,
      factsLoading: analysis.loading,
      openReview: (id) => openReview(id ? { id } : undefined),
      arrival,
    }),
    [
      project.id,
      mode,
      brief,
      visuals,
      statementById,
      critiques,
      anchors,
      analysis.facts,
      analysis.loading,
      openReview,
      arrival,
    ],
  );

  const reviewText = reviewHeadline(review.view, review.error !== null && review.view === null);
  const tools = (
    <Tools
      reviewText={reviewText}
      openCount={review.view?.critiques ? counts.open : null}
      may={view.may}
      generating={generating}
      report={reportTool(project, view.may.generate)}
      url={url}
      onReview={() => openReview()}
      onStudio={go.studio}
      onReport={go.report}
      onGenerate={generate}
      onOpenAll={openEvery}
    />
  );

  const comparisonRunning = project.lab?.analysis === 'running';
  let currentAct: string | null = null;
  let actIndex = -1;

  return (
    <DocContext.Provider value={context}>
      <div
        className="sw-decide"
        ref={root}
        data-reveal={reduced ? 'off' : 'on'}
        data-busy={generating || undefined}
      >
        <DocBar
          shown={barShown}
          where={where}
          reviewCount={review.view?.critiques ? counts.open : null}
          onContents={() => setContentsOpen(true)}
          onReview={() => openReview()}
          url={url}
          mayExport={view.may.export}
        />
        {generating && (
          <div className="sw-decide-busy sw-glass sw-glass--overlay" role="status">
            <Orbit size={20} label="Writing the brief again" />
            <span>Writing the brief again…</span>
          </div>
        )}
        {handle.error && !handle.loading && (
          <Notice
            tone="caution"
            className="sw-decide__notice"
            title="The brief could not be refreshed"
            action={
              <Button size="sm" variant="glass" onClick={handle.reload}>
                Try again
              </Button>
            }
          >
            {handle.error} What is shown is the last version that could be read.
          </Notice>
        )}
        {generateError && (
          <Notice
            tone="error"
            className="sw-decide__notice"
            title="The brief could not be made"
            action={
              view.may.generate ? (
                <Button size="sm" variant="glass" onClick={generate}>
                  Try again
                </Button>
              ) : null
            }
          >
            {generateError}
          </Notice>
        )}

        <Hero
          hero={hero}
          freshness={freshness}
          may={view.may}
          generating={generating}
          onGenerate={generate}
          onRerun={go.simulate}
          review={{ view: review.view, failed: review.error !== null && review.view === null }}
          tools={tools}
          comparisonRunning={comparisonRunning}
          onNext={present.includes('recommendations') ? () => reveal('recommendations') : null}
          topRef={heroTop}
        />

        <div className="sw-decide-body">
          <ContentsRail
            chapters={chapters}
            active={place}
            notes={notes}
            onSelect={reveal}
            onOpenAll={openEvery}
            allOpen={allOpen}
          />
          <div className="sw-decide-doc" id={CHAPTERS_ANCHOR} tabIndex={-1}>
            {chapters.map((chapter: Chapter) => {
              const act = ACTS.find((entry) => entry.id === chapter.spec.act);
              const begins = act && act.id !== currentAct;
              if (begins) {
                currentAct = act.id;
                actIndex += 1;
              }
              const id = chapter.spec.id;
              return (
                <Fragment key={id}>
                  {begins && act ? <ActDivider label={act.label} index={actIndex} /> : null}
                  <ChapterShell
                    id={id}
                    title={chapter.title}
                    gist={id === 'review' ? null : gistOf(id, brief, visuals)}
                    reference={chapter.spec.reference}
                    open={open.has(id)}
                    onToggle={() => toggle(id)}
                    noteCount={id === 'review' ? 0 : (notes.get(id) ?? 0)}
                  >
                    <ChapterBody
                      chapter={chapter}
                      review={
                        <ReviewChapter
                          state={review}
                          arrival={arrival}
                          onOpen={openReview}
                          onRerun={go.simulate}
                        />
                      }
                    />
                  </ChapterShell>
                </Fragment>
              );
            })}
            <footer className="sw-decide-foot">
              <p>{POSITIONING_STATEMENT}</p>
              <p className="sw-decide-foot__meta num">
                {plural(brief.methodology.runsPerVariant, 'seeded run')} of{' '}
                {plural(brief.methodology.rounds, 'round')} for each of{' '}
                {plural(brief.methodology.variants.length, 'scenario')}, from base seed{' '}
                {brief.methodology.baseSeed}
                {mode === 'advanced' ? ` · analysis ${brief.analysisId}` : ''}.
              </p>
            </footer>
          </div>
        </div>
      </div>

      <ReviewSheet
        open={reviewOpen}
        onOpenChange={onReviewOpenChange}
        state={review}
        focusId={focus.id}
        role={focus.role}
        onRerun={go.simulate}
        onConflicts={go.ground}
      />

      <Sheet open={contentsOpen} onOpenChange={setContentsOpen}>
        <SheetContent
          width="sm"
          title="Contents"
          eyebrow="Decision brief"
          className="sw-decide-sheet"
        >
          <div className="sw-decide-sheet-toc">
            <ContentsList
              chapters={chapters}
              active={place}
              notes={notes}
              onSelect={(target) => {
                setContentsOpen(false);
                window.setTimeout(() => reveal(target), 180);
              }}
            />
            <button type="button" className="sw-decide-rail__all" onClick={openEvery}>
              {allOpen ? 'Close the reference' : 'Open every chapter'}
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </DocContext.Provider>
  );
}
