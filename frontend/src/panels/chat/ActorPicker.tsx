import { useEffect, useRef } from 'react';
import type { Agent } from '../../../../shared/types';
import { Segmented } from '../../design/ui';
import { Orb } from '../shared/Orb';

/** The actors of the project, as a row to choose one from; the chosen one is scrolled into view. */
export function ActorPicker({
  agents,
  value,
  onChange,
}: {
  agents: readonly Agent[];
  value: string;
  onChange: (id: string) => void;
}) {
  const shell = useRef<HTMLDivElement>(null);
  useEffect(() => {
    shell.current
      ?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
      ?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [value]);
  return (
    <div ref={shell} className="sw-chat__picker">
      <Segmented
        label="Actor to talk to"
        size="sm"
        value={value}
        onChange={onChange}
        options={agents.map((agent) => ({
          value: agent.id,
          label: agent.name,
          icon: <Orb seed={agent.id} size={16} />,
        }))}
      />
    </div>
  );
}
