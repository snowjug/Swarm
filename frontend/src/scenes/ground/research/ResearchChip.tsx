import { CircleAlert, CircleCheck, CircleX, PauseCircle, Square } from 'lucide-react';
import { Chip } from '../../../design/ui';
import type { StatusWords } from './model';

/** The status at the head of the page, in the words of the stage the run is in. */
export function ResearchChip({ words }: { words: StatusWords }) {
  const icon =
    words.icon === 'check' ? (
      <CircleCheck aria-hidden="true" />
    ) : words.icon === 'pause' ? (
      <PauseCircle aria-hidden="true" />
    ) : words.icon === 'alert' ? (
      <CircleAlert aria-hidden="true" />
    ) : words.icon === 'stop' ? (
      <Square aria-hidden="true" />
    ) : words.icon === 'cross' ? (
      <CircleX aria-hidden="true" />
    ) : undefined;
  return (
    <Chip
      tone={words.tone}
      dot={words.dot}
      icon={icon}
      size="sm"
      className="sw-ground__status"
      data-stage={words.dot ? 'running' : undefined}
      data-moment={`research-${words.key}`}
    >
      {words.label}
    </Chip>
  );
}
