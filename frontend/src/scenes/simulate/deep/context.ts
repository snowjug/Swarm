import { createContext, useContext } from 'react';
import type { Platform } from '../../../../../shared/guided';
import type { ProjectDetail } from '../../../../../shared/types';
import type { MemoryFilter, PlatformView, RunControls } from './model';
import type { EnvironmentCheck } from './validation';
import type { EnvironmentUpdate } from '../../../../../shared/guided';
import type { DraftChanges } from './model';

export type DeepTab = 'setup' | 'run' | 'rounds' | 'memory' | 'engine';

export interface EnvironmentDraft {
  /** The saved environment as the editor starts from it, or null where there is none. */
  initial: EnvironmentUpdate | null;
  draft: EnvironmentUpdate | null;
  setDraft: (next: EnvironmentUpdate) => void;
  changes: DraftChanges | null;
  check: EnvironmentCheck | null;
  /** The person may change it: nothing has run, and the server is not busy. */
  editable: boolean;
  saving: boolean;
  error: string | null;
  save: () => Promise<boolean>;
  discard: () => void;
}

export interface RunActions {
  /** The name of the action that is waiting for the server, or null. */
  pending: string | null;
  error: string | null;
  clearError: () => void;
  prepare: () => void;
  start: () => void;
  cancel: () => void;
  pause: () => void;
  resume: () => void;
  /** Starts the simulation again from round 1, discarding what was saved. */
  restart: () => Promise<boolean>;
  report: () => void;
  openReport: () => void;
}

export interface DeepState {
  project: ProjectDetail;
  whatIf: boolean;
  advanced: boolean;
  controls: RunControls;
  platforms: PlatformView[];
  actions: RunActions;
  environment: EnvironmentDraft;

  tab: DeepTab;
  setTab: (tab: DeepTab) => void;

  /** The platform in view in the rounds and the memory. Never both at once: they are not one audience. */
  platform: Platform;
  setPlatform: (platform: Platform) => void;

  /** The round in view, 0 being the start. */
  round: number;
  setRound: (round: number) => void;

  filter: MemoryFilter;
  setFilter: (filter: MemoryFilter) => void;

  /** Opens a proxy in its sheet, to read it, or to edit it where the environment is open. */
  openProxy: (id: string) => void;
  openBranch: (fromRound?: number) => void;
  askRestart: () => void;
  announce: (message: string) => void;
  /** Goes to the memory stream with a filter set, so that a round or a proxy can be followed there. */
  followInMemory: (filter: Partial<MemoryFilter>) => void;
}

export const DeepContext = createContext<DeepState | null>(null);

export function useDeep(): DeepState {
  const state = useContext(DeepContext);
  if (!state) throw new Error('The deep dive needs its provider above it.');
  return state;
}
