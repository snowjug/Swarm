import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace } from '../../app/context';
import { DURATION, useReducedMotion } from '../../design/motion';
import { Conflicts } from './Conflicts';
import { EvidenceSheet } from './EvidenceSheet';
import { Hero } from './Hero';
import { SectionHead } from './SectionHead';
import { SourceRows } from './SourceRows';
import { NoStatements, Statements } from './Statements';
import { StickyNext } from './StickyNext';
import { Trace } from './Trace';
import { nothingFocused, opener, whenReachable } from './arrive';
import {
  GroundActionsContext,
  GroundDataContext,
  GroundLitContext,
  type GroundActions,
  type GroundData,
  type GroundSelection,
  type SheetTarget,
} from './context';
import { buildGraphView, deriveLit, layoutPlacements, type Focus } from './graphModel';
import { documentList, graphOf, groundStage, parseView, type GroundView } from './model';
import { useGroundLedger } from './useGroundLedger';
import { usePassages } from './usePassages';
import './ground.css';

const NO_SELECTION: GroundSelection = { node: null, edge: null, pinnedDocument: null };

/** Keeps the same value while its key is the same, so that what is built from it is not built again. */
function useStable<T>(value: T, key: string): T {
  const held = useRef({ key, value });
  if (held.current.key !== key) held.current = { key, value };
  return held.current.value;
}

/** How long the page waits for a sheet to leave, or for what it is going to to appear, before it gives up. */
const REACH_MS = Math.round(DURATION.cinema * 8 * 1000);
/** Until the page has finished arriving (its entrances take at most this long) a link does not scroll. */
const SETTLE_MS = Math.round(DURATION.slow * 1000);
/** How long a conflict that was jumped to stays lit: its flash (`--dur-cinema`, twice) and a breath. */
const FLASH_MS = Math.round((DURATION.cinema * 2 + DURATION.fast) * 1000);

/**
 * Where focus goes when the last sheet of a stack closes. A sheet hands focus back to what opened it, but going
 * from one sheet to the next (a passage, then its document) loses that, so the control that opened the first is
 * kept here. It gets focus only if nothing else has taken it by then: a conflict that was gone to has, and keeps it.
 */
function useStackReturn(open: boolean) {
  const origin = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    const closed = wasOpen.current && !open;
    wasOpen.current = open;
    if (!closed) return undefined;
    const target = origin.current;
    origin.current = null;
    if (!target) return undefined;
    return whenReachable(
      () => target,
      (element) => {
        if (nothingFocused()) element.focus({ preventScroll: true });
      },
      REACH_MS,
    );
  }, [open]);
  const remember = useCallback(() => {
    if (!origin.current) origin.current = opener();
  }, []);
  const forget = useCallback(() => {
    origin.current = null;
  }, []);
  return useMemo(() => ({ remember, forget }), [remember, forget]);
}

/**
 * Ground: the evidence the exploration rests on. It reads the project the shell holds and shows what the
 * documents are, how they were cut into passages, what the sources talk about, where they disagree and, once a
 * report is written, every statement and what backs it. What the engine has not yet read is a dash, not a guess.
 */
export default function GroundScene() {
  const { project, mode, view, setView } = useWorkspace();
  const reduced = useReducedMotion();
  const stage = groundStage(project);
  const documents = useMemo(() => documentList(project), [project]);
  const documentKey = documents.map((doc) => doc.id).join(',');
  const stableDocuments = useStable(documents, `${project.id}:${documentKey}`);

  const passages = usePassages(project.id, project.documents.length);
  const conflictsKnown = (stage === 'ready' || stage === 'record') && project.documents.length > 0;
  const ledger = useGroundLedger(project.id, conflictsKnown, project.updatedAt);
  const conflicts = useMemo(
    () => (conflictsKnown ? (ledger.ledger?.contradictions ?? []) : []),
    [conflictsKnown, ledger.ledger],
  );

  const graph = graphOf(project);
  const graphKey = graph
    ? `${project.id}:${project.updatedAt}:${graph.nodes.length}:${graph.edges.length}`
    : '';
  const stableGraph = useStable(graph, graphKey);
  const placements = useMemo(
    () => (stableGraph ? layoutPlacements(stableGraph, project.settings.seed) : []),
    [stableGraph, project.settings.seed],
  );
  const graphView = useMemo(
    () =>
      stableGraph
        ? buildGraphView(
            stableGraph,
            placements,
            passages.index,
            stableDocuments.map((doc) => doc.id),
          )
        : null,
    [stableGraph, placements, passages.index, stableDocuments],
  );

  // ---- What is pointed at, and what lights up with it -----------------------------------------------
  const [hover, setHover] = useState<Focus | null>(null);
  const [selection, setSelection] = useState<GroundSelection>(NO_SELECTION);
  const lit = useMemo(() => {
    const focus: Focus =
      hover ??
      (selection.node
        ? { node: selection.node }
        : selection.edge !== null
          ? { edge: selection.edge }
          : selection.pinnedDocument
            ? { document: selection.pinnedDocument }
            : {});
    return deriveLit(focus, graphView, passages.index, conflicts);
  }, [hover, selection, graphView, passages.index, conflicts]);

  // ---- The sheet ------------------------------------------------------------------------------------
  const [sheets, setSheets] = useState<SheetTarget[]>([]);
  const stack = useStackReturn(sheets.length > 0);
  const push = useCallback(
    (target: SheetTarget) => {
      stack.remember();
      setSheets((old) => (target.kind === 'claim' ? [target] : [...old, target].slice(-6)));
    },
    [stack],
  );

  // ---- Moving about the page -----------------------------------------------------------------------
  const arrivedAt = useRef<GroundView | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // The conflict that has been asked for and not yet reached: what hides it (the reviewed ones) opens for it.
  const [seek, setSeek] = useState<string | null>(null);
  const reach = useCallback(
    (target: HTMLElement, focus: boolean) => {
      // Focus first: moving focus while a smooth scroll runs would stop the scroll.
      if (focus) target.focus({ preventScroll: true });
      // On the next frame, after whatever a closing sheet hands focus back to has done it, for the same reason.
      requestAnimationFrame(() =>
        target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }),
      );
    },
    [reduced],
  );
  const scrollTo = useCallback(
    (id: string, focus = true) => {
      const target = document.getElementById(id);
      if (target) reach(target, focus);
    },
    [reach],
  );
  // Going somewhere from a sheet waits until the sheet has gone: a closing sheet holds the page inert, and the
  // way back to what opened the sheet is given up, because the person is going somewhere else.
  const going = useRef<(() => void) | null>(null);
  useEffect(() => {
    const stop = going;
    return () => stop.current?.();
  }, []);
  const goWhenReachable = useCallback(
    (id: string, focus: boolean, arrived?: () => void, missed?: () => void) => {
      stack.forget();
      going.current?.();
      going.current = whenReachable(
        () => document.getElementById(id),
        (target) => {
          arrived?.();
          reach(target, focus);
        },
        REACH_MS,
        missed,
      );
    },
    [reach, stack],
  );

  const actions = useMemo<GroundActions>(
    () => ({
      openDocument: (id, options) => push({ kind: 'document', id, ...options }),
      openPassage: (id, options) => push({ kind: 'passage', id, ...options }),
      openBrowse: (query) => push({ kind: 'browse', query }),
      openClaim: (id) => push({ kind: 'claim', id }),
      selectNode: (id) => setSelection((old) => ({ ...old, node: id, edge: null })),
      selectEdge: (index) => setSelection((old) => ({ ...old, node: null, edge: index })),
      hover: (focus) => setHover(focus),
      pinDocument: (id) => setSelection((old) => ({ ...old, pinnedDocument: id })),
      goTo: (next) => {
        arrivedAt.current = next;
        setView(next);
        goWhenReachable(next === 'graph' ? 'ground-graph' : `ground-${next}`, next !== 'graph');
      },
      showConflict: (id) => {
        arrivedAt.current = 'conflicts';
        setView('conflicts');
        setSeek(id);
        goWhenReachable(
          `ground-conflict-${id}`,
          true,
          () => {
            setSeek(null);
            setFlash(id);
            window.setTimeout(
              () => setFlash((current) => (current === id ? null : current)),
              FLASH_MS,
            );
          },
          () => setSeek(null),
        );
      },
    }),
    [push, goWhenReachable, setView],
  );

  // A link that names a part of the page opens there, once what it names has arrived and the page has
  // stopped growing. `arrivedAt` is set only when the scroll happens: effects that run twice, or a timer
  // that is cleared, must not use the link up.
  const wanted = parseView(view);
  const ready = stage === 'ready' || stage === 'record';
  const read = !conflictsKnown || ledger.ledger !== null || ledger.error !== null;
  useEffect(() => {
    if (!wanted || !ready || !read || arrivedAt.current === wanted) return undefined;
    const timer = window.setTimeout(() => {
      arrivedAt.current = wanted;
      scrollTo(wanted === 'graph' ? 'ground-graph' : `ground-${wanted}`, wanted !== 'graph');
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [wanted, ready, read, scrollTo]);

  const openClaimId = (() => {
    const top = sheets.at(-1);
    return top?.kind === 'claim' ? top.id : null;
  })();
  const data = useMemo<GroundData>(
    () => ({
      project,
      mode,
      stage,
      documents: stableDocuments,
      passages,
      graph: graphView,
      ledger,
      conflictsKnown,
      openClaimId,
    }),
    [
      project,
      mode,
      stage,
      stableDocuments,
      passages,
      graphView,
      ledger,
      conflictsKnown,
      openClaimId,
    ],
  );
  const litValue = useMemo(() => ({ lit, selection }), [lit, selection]);

  const claims = ledger.ledger?.claims ?? [];
  const showSources = graphView !== null && stableDocuments.length > 0;

  return (
    <GroundDataContext.Provider value={data}>
      <GroundActionsContext.Provider value={actions}>
        <GroundLitContext.Provider value={litValue}>
          <div className="sw-ground">
            <Hero />

            {showSources && (
              <section className="sw-ground__section" aria-labelledby="ground-sources-title">
                <SectionHead
                  id="ground-sources"
                  titleId="ground-sources-title"
                  title="Sources"
                  count={stableDocuments.length}
                />
                <SourceRows variant="list" reading="done" />
              </section>
            )}

            {conflictsKnown && <Conflicts flash={flash} seek={seek} />}
            {conflictsKnown && claims.length > 0 && <Statements />}
            {conflictsKnown && claims.length === 0 && ledger.ledger && (
              <NoStatements checked={ledger.ledger.reviewedAt !== null} />
            )}
            {mode === 'advanced' && <Trace />}
          </div>
          <EvidenceSheet stack={sheets} onStack={setSheets} />
          <StickyNext />
        </GroundLitContext.Provider>
      </GroundActionsContext.Provider>
    </GroundDataContext.Provider>
  );
}
