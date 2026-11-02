import { useCallback, useEffect, useEffectEvent, useState } from 'react';

let issued = 0;
const issue = (): number => ++issued;

/**
 * Keys for the rows of a list that has no ids of its own (the changes of a scenario, the groups that are affected),
 * so that the row that is taken away is the row that animates out. Keyed by position, the last row would leave
 * and the contents of the rest would be shifted into the ones before it, which for a moment shows the same row
 * twice. `add` and `remove` go with the change to the list itself; a list replaced from outside gets keys by position.
 */
export function useRowKeys(length: number): {
  keys: readonly number[];
  add: () => void;
  remove: (index: number) => void;
} {
  const [own, setOwn] = useState<number[]>(() => Array.from({ length }, issue));
  const keys =
    own.length === length ? own : Array.from({ length }, (_, index) => own[index] ?? -(index + 1));
  return {
    keys,
    add: () => setOwn([...keys, issue()]),
    remove: (index) => setOwn(keys.filter((_, at) => at !== index)),
  };
}

/**
 * Puts focus on a control once the thing that had it has gone: a row that is removed takes the focus with it, and
 * without this a keyboard would start again from the top of the page. `find` is asked where focus goes after the
 * list has been drawn without the row, and the function that is returned is what to call when one is removed.
 */
export function useRefocus(find: () => HTMLElement | null): () => void {
  const [asked, setAsked] = useState(0);
  const focus = useEffectEvent(() => find()?.focus({ preventScroll: true }));
  useEffect(() => {
    if (asked > 0) focus();
  }, [asked]);
  return useCallback(() => setAsked((old) => old + 1), []);
}
