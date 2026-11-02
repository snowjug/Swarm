import { Component, Suspense, lazy, useMemo, useState } from 'react';
import type { ComponentType, ErrorInfo, ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button, EmptyState, Orbit } from '../../design/ui';
import { useWorkspace } from '../../app/context';
import './sub.css';

/**
 * The editor and the detailed report are scenes of their own, built apart from this one. They are looked up
 * rather than imported by name, so that this scene opens whether or not they are there yet.
 */
const loaders = import.meta.glob<{ default: ComponentType }>([
  '../studio/index.tsx',
  '../report/index.tsx',
]);

export type SubName = 'studio' | 'report';

const TITLES: Record<SubName, string> = { studio: 'Edit report', report: 'Detailed report' };

class Boundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(_error: unknown, _info: ErrorInfo): void {
    // The fallback says it; there is nothing to send anywhere.
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Unavailable({
  name,
  onRetry,
  onBack,
}: {
  name: SubName;
  onRetry: (() => void) | null;
  onBack: () => void;
}) {
  return (
    <div className="sw-decide-sub__body">
      <EmptyState
        level={1}
        title={`${TITLES[name]} could not be opened`}
        action={
          <div className="sw-decide-sub__actions">
            {onRetry && (
              <Button variant="primary" onClick={onRetry}>
                Try again
              </Button>
            )}
            <Button variant="glass" onClick={onBack}>
              Back to the brief
            </Button>
          </div>
        }
      >
        It did not load. Nothing was changed; the decision brief is still where you left it.
      </EmptyState>
    </div>
  );
}

/** One attempt at opening the scene: a module that failed to load is not asked for again by the same component. */
function Attempt({
  name,
  onRetry,
  onBack,
}: {
  name: SubName;
  onRetry: () => void;
  onBack: () => void;
}) {
  const Scene = useMemo(() => {
    const loader = loaders[`../${name}/index.tsx`];
    return loader ? lazy(loader) : null;
  }, [name]);
  if (!Scene) return <Unavailable name={name} onRetry={null} onBack={onBack} />;
  return (
    <Boundary fallback={<Unavailable name={name} onRetry={onRetry} onBack={onBack} />}>
      <Suspense
        fallback={
          <div className="sw-decide-sub__loading" role="status">
            <Orbit size={28} label={`Opening ${TITLES[name].toLowerCase()}`} />
          </div>
        }
      >
        <Scene />
      </Suspense>
    </Boundary>
  );
}

/** A scene beside the brief, reached from its tools, with a way back to it that is always there. */
export function SubScene({ name }: { name: SubName }) {
  const { setView } = useWorkspace();
  const [attempt, setAttempt] = useState(0);
  const back = () => setView(null);
  return (
    <div className="sw-decide-sub">
      <nav className="sw-decide-sub__nav" aria-label="Where you are">
        <button type="button" className="sw-decide-sub__back" onClick={back}>
          <ArrowLeft size={16} aria-hidden="true" />
          <span>Decision brief</span>
        </button>
        <span className="sw-decide-sub__here" aria-current="page">
          {TITLES[name]}
        </span>
      </nav>
      <Attempt
        key={`${name}-${attempt}`}
        name={name}
        onRetry={() => setAttempt((old) => old + 1)}
        onBack={back}
      />
    </div>
  );
}
