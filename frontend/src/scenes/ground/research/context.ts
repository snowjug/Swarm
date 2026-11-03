import { createContext, useContext, type RefObject } from 'react';
import type { ResearchState } from '../../../hooks/useResearch';
import type { Controls, Presence } from './model';

/**
 * What the Ground page holds of the project's research, for the parts of the page that show it: the head of the page
 * (its status, its figures, its actions) and the section that is the research itself. A scene that is not given this
 * (a project that has none) is drawn as it always was.
 */
export interface GroundResearch {
  state: ResearchState;
  presence: Presence;
  /** Research is what the first screen is about: its figures, its status and its actions are the head of the page's. */
  takesOver: boolean;
  controls: Controls;
  /** The field that names a site or a page to add: where a person who has nowhere else to go is taken. */
  addField: RefObject<HTMLInputElement | null>;
  /** Goes to the research on the page, and to its field for a site or a page when there is one. */
  showAdd: () => void;
  showResearch: () => void;
}

export const GroundResearchContext = createContext<GroundResearch | null>(null);

export const useGroundResearch = (): GroundResearch | null => useContext(GroundResearchContext);
