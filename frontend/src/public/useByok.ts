import { useSyncExternalStore } from 'react';
import type { ByokModel } from '../../../shared/public';
import {
  byokHint,
  byokModel,
  byokModels,
  byokVersion,
  holdsByokKey,
  subscribeByok,
} from './byokStore';

/**
 * What a component may know about the held key: that there is one, its last four characters, the model chosen and the
 * models the key can use.
 */
export function useByok(): {
  hasKey: boolean;
  hint: string | null;
  model: string | null;
  models: ByokModel[];
} {
  useSyncExternalStore(subscribeByok, byokVersion, byokVersion);
  return { hasKey: holdsByokKey(), hint: byokHint(), model: byokModel(), models: byokModels() };
}
