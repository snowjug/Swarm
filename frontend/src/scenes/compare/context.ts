import { createContext, useContext } from 'react';

/** What every part of the page needs to know that is not in the comparison itself. */
export interface CompareContext {
  /** Advanced shows the engine's own terms (ids, raw categories, traits) beside the plain words. */
  advanced: boolean;
}

export const CompareScope = createContext<CompareContext>({ advanced: false });

export const useCompare = (): CompareContext => useContext(CompareScope);
