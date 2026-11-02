import { ArrowRight, GitBranch, RefreshCw } from 'lucide-react';
import { DEMO_PROJECTS } from '../../../../shared/demo';
import type { ProjectSummary } from '../../../../shared/types';
import { Button, Chip, Notice, Skeleton } from '../../design/ui';
import { ago } from './time';
import './Recents.css';

const STATUS_TONE = {
  running: 'accent',
  queued: 'accent',
  failed: 'against',
  cancelled: 'neutral',
  completed: 'favor',
  ready: 'neutral',
  draft: 'neutral',
} as const;

/**
 * Where to go back to: the explorations already started, newest first, and the recorded demonstrations when
 * the workspace has them. It says nothing of a demonstration that is not there.
 */
export function Recents({
  projects,
  loading,
  error,
  busy,
  onOpen,
  onRetry,
  onHistory,
}: {
  projects: ProjectSummary[] | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  onOpen: (id: string) => void;
  onRetry: () => void;
  onHistory: () => void;
}) {
  const demos = DEMO_PROJECTS.filter((demo) => projects?.some((project) => project.id === demo.id));
  const recent = (projects ?? [])
    .filter((project) => !DEMO_PROJECTS.some((demo) => demo.id === project.id))
    .slice(0, 4);
  if (!loading && !error && recent.length === 0 && demos.length === 0) return null;
  return (
    <section className="sw-recents" aria-labelledby="sw-recents-title">
      <header className="sw-recents__head">
        <h2 id="sw-recents-title" className="sw-eyebrow">
          Continue
        </h2>
        {projects && projects.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            iconEnd={<ArrowRight size={14} aria-hidden="true" />}
            onClick={onHistory}
          >
            All explorations
          </Button>
        )}
      </header>
      {loading && !projects && (
        <div className="sw-recents__skeleton" aria-hidden="true">
          <Skeleton height="3.2rem" />
          <Skeleton height="3.2rem" />
        </div>
      )}
      {error && (
        <Notice
          tone="error"
          title="Your explorations could not be read"
          action={
            <Button
              size="sm"
              variant="glass"
              icon={<RefreshCw size={14} aria-hidden="true" />}
              busy={loading}
              onClick={onRetry}
            >
              Retry
            </Button>
          }
        >
          {error}
        </Notice>
      )}
      {recent.length > 0 && (
        <ul className="sw-recents__list">
          {recent.map((project, index) => (
            <li
              key={project.id}
              className="sw-rise"
              style={{ '--i': index + 8 } as React.CSSProperties}
            >
              <button
                type="button"
                className="sw-recents__item"
                disabled={busy}
                onClick={() => onOpen(project.id)}
              >
                <span className="sw-recents__main">
                  <span className="sw-recents__name">{project.name}</span>
                  <span className="sw-recents__question">{project.question}</span>
                </span>
                <span className="sw-recents__meta">
                  <Chip size="sm" tone={STATUS_TONE[project.status]} dot>
                    {project.status}
                  </Chip>
                  <span className="sw-caption">{ago(project.updatedAt)}</span>
                </span>
                <ArrowRight className="sw-recents__go" size={18} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {demos.length > 0 && (
        <div className="sw-recents__demos">
          <h3 className="sw-eyebrow">Recorded demonstration</h3>
          <p className="sw-caption">
            A fictional island ferry, recorded with a real model. Nothing in it describes a real
            place.
          </p>
          <ul className="sw-recents__list">
            {demos.map((demo) => (
              <li key={demo.id}>
                <button
                  type="button"
                  className="sw-recents__item"
                  disabled={busy}
                  onClick={() => onOpen(demo.id)}
                >
                  <span className="sw-recents__main">
                    <span className="sw-recents__name">{demo.title}</span>
                    <span className="sw-recents__question">{demo.summary}</span>
                  </span>
                  <span className="sw-recents__meta">
                    {demo.role === 'branch' ? (
                      <Chip size="sm" icon={<GitBranch size={12} aria-hidden="true" />}>
                        Branch
                      </Chip>
                    ) : (
                      <Chip size="sm">Base run</Chip>
                    )}
                  </span>
                  <ArrowRight className="sw-recents__go" size={18} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
