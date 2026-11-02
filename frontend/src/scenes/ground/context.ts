import { createContext, useContext } from 'react';
import type { Ledger } from '../../../../shared/evidence';
import type { ProjectDetail } from '../../../../shared/types';
import type { UiMode } from '../../lib/mode';
import type { Focus, GraphView, Lit } from './graphModel';
import type { DocumentFacts, GroundStage, GroundView } from './model';
import type { PassageIndex } from './passages';

/** What the side sheet is showing. A document and a passage open on the evidence; a claim on its record. */
export type SheetTarget =
  | { kind: 'document'; id: string; passageId?: string | null; quote?: string | null }
  | { kind: 'passage'; id: string; quote?: string | null }
  | { kind: 'browse'; query?: string }
  | { kind: 'claim'; id: string };

export interface PassagesView {
  index: PassageIndex | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export interface LedgerView {
  ledger: Ledger | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** Takes the ledger a review returned, so that the page shows it at once. */
  replace: (next: Ledger) => void;
}

export interface GroundData {
  project: ProjectDetail;
  mode: UiMode;
  stage: GroundStage;
  documents: DocumentFacts[];
  passages: PassagesView;
  graph: GraphView | null;
  ledger: LedgerView;
  /** The conflicts are only read once the engine has read the sources. */
  conflictsKnown: boolean;
  /** This page has seen the engine at work, as against one that was opened on a project that was already done. */
  watchedRun: boolean;
  /** The statement whose sheet is open, if any: its row in the list is pressed. */
  openClaimId: string | null;
}

export interface GroundActions {
  openDocument: (
    id: string,
    options?: { passageId?: string | null; quote?: string | null },
  ) => void;
  openPassage: (id: string, options?: { quote?: string | null }) => void;
  openBrowse: (query?: string) => void;
  openClaim: (id: string) => void;
  /** Selects a topic or a link in the graph (null clears it). */
  selectNode: (id: string | null) => void;
  selectEdge: (index: number | null) => void;
  /** What the pointer or the keyboard is on, so that what it rests on lights up. Null clears it. */
  hover: (focus: Focus | null) => void;
  /** Keeps one document in the light until it is chosen again. */
  pinDocument: (id: string | null) => void;
  /** Scrolls to a part of the page and puts the focus there. */
  goTo: (view: GroundView) => void;
  /** Scrolls to one conflict and puts the focus on it. */
  showConflict: (id: string) => void;
}

export interface GroundSelection {
  node: string | null;
  edge: number | null;
  pinnedDocument: string | null;
}

export const GroundDataContext = createContext<GroundData | null>(null);
export const GroundActionsContext = createContext<GroundActions | null>(null);
export const GroundLitContext = createContext<{ lit: Lit; selection: GroundSelection } | null>(
  null,
);

function need<T>(value: T | null, name: string): T {
  if (value === null) throw new Error(`${name} needs the ground scene above it.`);
  return value;
}

export const useGroundData = (): GroundData => need(useContext(GroundDataContext), 'useGroundData');
export const useGroundActions = (): GroundActions =>
  need(useContext(GroundActionsContext), 'useGroundActions');
export const useGroundLit = () => need(useContext(GroundLitContext), 'useGroundLit');
