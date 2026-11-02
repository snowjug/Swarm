import { useCallback, useEffect, useRef } from 'react';
import { useWorkspace } from '../../app/context';

/**
 * What a scene calls when it knows something the shell will only learn at its next reading of the project (a comparison
 * that has just started or finished): it has the shell read the project again, with nothing spinning. The function is the
 * same on every draw, so that giving it to a hook that watches something does not restart the watching.
 */
export function useCatchUp(): () => void {
  const { refresh } = useWorkspace();
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  }, [refresh]);
  return useCallback(() => latest.current({ quiet: true }), []);
}
