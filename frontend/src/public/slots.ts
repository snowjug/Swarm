import { createContext, useContext, type ReactNode } from 'react';

/**
 * What the signed-in public page puts into the shell: a meter in the top bar and the account part of the settings menu.
 * The shell reads it from here and shows nothing of its own when there is none, which is how the pilot is: the context
 * has no provider there, so both places are what they always were.
 */
export interface PublicSlots {
  meter: ReactNode;
  menu: ReactNode;
}

export const PublicSlotsContext = createContext<PublicSlots | null>(null);

export function usePublicSlots(): PublicSlots | null {
  return useContext(PublicSlotsContext);
}
