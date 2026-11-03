import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  Compass,
  GitBranch,
  MessageCircleQuestion,
  Search,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { cx } from '../../design/cx';
import type { FlowId, FlowStep } from './flow';
import './Explainer.css';

const ICONS: Record<FlowId, LucideIcon> = {
  question: MessageCircleQuestion,
  research: Search,
  people: Users,
  futures: GitBranch,
  decision: Compass,
};

/** How long a pointer rests on a step before it is read as meaning it: one that is only passing over does not. */
const INTENT_MS = 90;

/**
 * The way from a question to a decision, as five steps a person can open. A step is a button: pressing it, or resting a
 * pointer on it, shows what Swarm does there and what the person decides. Nothing moves until it is asked. The steps
 * are a numbered list and the open one is words, so that nothing is told by the drawing alone.
 */
export function Explainer({ steps }: { steps: readonly FlowStep[] }) {
  const id = useId();
  const [active, setActive] = useState(0);
  const [touched, setTouched] = useState(false);
  const nodes = useRef<(HTMLButtonElement | null)[]>([]);
  const resting = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(resting.current), []);

  const open = (index: number) => {
    setActive(index);
    setTouched(true);
  };
  const move = (event: KeyboardEvent, index: number) => {
    const last = steps.length - 1;
    const target =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? Math.min(index + 1, last)
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? Math.max(index - 1, 0)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    nodes.current[target]?.focus();
  };

  return (
    <section
      className="sw-ask-flow"
      aria-labelledby={`${id}-title`}
      data-touched={touched || undefined}
    >
      <h2 id={`${id}-title`} className="sw-ask-flow__title sw-eyebrow">
        How Swarm works
      </h2>
      <ol className="sw-ask-flow__steps" role="list" aria-labelledby={`${id}-title`}>
        {steps.map((step, index) => {
          const Icon = ICONS[step.id];
          return (
            <li
              key={step.id}
              className={cx(
                'sw-ask-flow__step',
                index === active && 'is-active',
                index < active && 'is-past',
              )}
            >
              <button
                type="button"
                id={`${id}-${step.id}-node`}
                ref={(node) => {
                  nodes.current[index] = node;
                }}
                className="sw-ask-flow__node"
                aria-label={step.name}
                aria-expanded={index === active}
                aria-controls={`${id}-${step.id}`}
                onClick={() => open(index)}
                onKeyDown={(event) => move(event, index)}
                onPointerEnter={(event) => {
                  if (event.pointerType !== 'mouse') return;
                  clearTimeout(resting.current);
                  resting.current = setTimeout(() => open(index), INTENT_MS);
                }}
                onPointerLeave={() => clearTimeout(resting.current)}
              >
                <span className="sw-ask-flow__glyph" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <span className="sw-ask-flow__name" aria-hidden="true">
                  <span className="sw-ask-flow__full">{step.name}</span>
                  <span className="sw-ask-flow__short">{step.short}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="sw-ask-flow__details">
        {steps.map((step, index) => (
          <div
            key={step.id}
            id={`${id}-${step.id}`}
            className="sw-ask-flow__detail"
            role="group"
            aria-labelledby={`${id}-${step.id}-node`}
            data-active={index === active || undefined}
          >
            <p>
              <strong>Swarm</strong> {step.swarm}
            </p>
            <p>
              <strong>You</strong> {step.you}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
