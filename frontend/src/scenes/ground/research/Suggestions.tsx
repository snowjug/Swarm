import { Check, Plus } from 'lucide-react';
import { useState } from 'react';
import { SOURCE_CATEGORY_LABELS, type ResearchRun } from '../../../../../shared/research';
import { Button, Chip } from '../../../design/ui';
import { isLive } from '../../../lib/research';
import { useGroundResearch } from './context';
import { suggestionsOf } from './model';

/**
 * What the plan says is worth reading, and where. A suggestion is shown and is never read on its own: a site is read
 * when a person adds it, and the one that names no site is only a kind of source to look for.
 */
export function Suggestions({ run }: { run: ResearchRun }) {
  const research = useGroundResearch();
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<string | null>(null);
  const items = suggestionsOf(run);
  if (items.length === 0 || !research) return null;
  const { state, controls } = research;
  const live = isLive(run.status);
  const naming = items.some((item) => item.address);

  const add = async (key: string, address: string) => {
    setPending(key);
    const ok = await state.addSource(address);
    setPending(null);
    if (ok) setAdded((old) => new Set(old).add(key));
  };

  return (
    <div className="sw-research-suggest">
      <h3 className="sw-research-sub" id="ground-research-suggest">
        Suggestions
      </h3>
      <p className="sw-research-quiet sw-caption">
        {naming ? (
          <>
            From the plan. Swarm reads a suggested site only when you add it
            {live ? ', which you can do once the research has stopped.' : '.'}
          </>
        ) : (
          <>
            From the plan: the kinds of source worth looking for. Swarm reads a site or a page only
            when one is named{live ? ', which you can do once the research has stopped.' : '.'}
          </>
        )}
      </p>
      <ul
        className="sw-research-suggest__list"
        role="list"
        aria-labelledby="ground-research-suggest"
      >
        {items.map((item) => {
          // What a person added is "Added", whether or not the run has read it by now.
          const label = added.has(item.key) ? 'Added' : item.read ? 'Already read' : null;
          return (
            <li key={item.key} className="sw-research-suggest__item">
              <div className="sw-research-suggest__text">
                <Chip size="sm">{SOURCE_CATEGORY_LABELS[item.category]}</Chip>
                <p className="sw-research-suggest__what">{item.description}</p>
                {item.site && <p className="sw-research-suggest__site">{item.site}</p>}
              </div>
              {item.address && label && (
                <span className="sw-research-suggest__done">
                  <Check size={15} strokeWidth={2.5} aria-hidden="true" />
                  {label}
                </span>
              )}
              {item.address && !label && controls.add && (
                <Button
                  size="sm"
                  variant="glass"
                  icon={<Plus size={15} aria-hidden="true" />}
                  aria-label={`Add this site: ${item.site}`}
                  disabled={state.working !== null}
                  busy={pending === item.key}
                  onClick={() => void add(item.key, item.address!)}
                >
                  Add this site
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
