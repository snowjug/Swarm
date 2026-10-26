import { useRef, useState } from 'react';
import {
  ArrowUpRight,
  ChevronLeft,
  FlaskConical,
  History,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { AppConfig, ProjectSummary } from '../../../shared/types';
import { dateTime } from '../lib/format';
import { Spinner, StatusBadge } from './ui';

export function Sidebar({
  projects,
  total,
  selectedId,
  loading,
  error,
  config,
  open,
  mobile,
  onClose,
  onHome,
  onNew,
  onSelect,
  onRefresh,
}: {
  projects: ProjectSummary[];
  total: number;
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  config: AppConfig | null;
  open: boolean;
  mobile: boolean;
  onClose: () => void;
  onHome: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState('');
  const asideRef = useRef<HTMLElement>(null);
  const filtered = projects.filter((project) =>
    `${project.name} ${project.question}`.toLowerCase().includes(query.toLowerCase()),
  );
  const navigate = (callback: () => void) => {
    callback();
    onClose();
  };
  return (
    <>
      {open && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close experiment history"
          onClick={onClose}
          tabIndex={-1}
        />
      )}
      <aside
        ref={asideRef}
        id="experiment-sidebar"
        className={`sidebar ${open ? 'sidebar-open' : ''}`}
        aria-label="Experiment navigation"
        role={mobile && open ? 'dialog' : undefined}
        aria-modal={mobile && open ? true : undefined}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
          if (event.key === 'Tab' && mobile && open) {
            const elements = Array.from(
              asideRef.current?.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), a[href]',
              ) ?? [],
            ).filter((element) => element.offsetParent !== null);
            const first = elements[0];
            const last = elements.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="sidebar-brand">
          <button
            className="brand-button"
            type="button"
            onClick={() => navigate(onHome)}
            aria-label="Swarm Lab home"
          >
            <span className="brand-symbol" aria-hidden="true">
              <svg viewBox="0 0 40 40" fill="none">
                <path d="m20 3 15 8.5v17L20 37 5 28.5v-17L20 3Z" />
                <path d="m20 11 8 4.5v9L20 29l-8-4.5v-9l8-4.5Zm0 0v18M5 11.5l15 8.7 15-8.7" />
              </svg>
            </span>
            <span>
              <strong>
                swarm<span className="brand-light">lab</span>
              </strong>
              <small>THE SCENARIO WORKBENCH</small>
            </span>
          </button>
          <button
            className="icon-button mobile-only"
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <X size={19} aria-hidden="true" />
          </button>
        </div>

        <button
          className="button button-primary new-experiment"
          type="button"
          onClick={() => navigate(onNew)}
        >
          <Plus size={17} aria-hidden="true" />
          New experiment
          <span className="button-trailing">
            <ArrowUpRight size={16} aria-hidden="true" />
          </span>
        </button>

        <button className="nav-home" type="button" onClick={() => navigate(onHome)}>
          <FlaskConical size={17} aria-hidden="true" />
          Lab overview
          <ChevronLeft size={14} className="home-arrow" aria-hidden="true" />
        </button>

        <div className="history-heading">
          <span>
            <History size={14} aria-hidden="true" /> EXPERIMENTS
          </span>
          <div>
            <span className="tiny-count">{total}</span>
            <button
              type="button"
              className="icon-button compact"
              onClick={onRefresh}
              disabled={loading}
              aria-label="Refresh experiment history"
            >
              <RefreshCw size={13} className={loading ? 'spin' : ''} aria-hidden="true" />
            </button>
          </div>
        </div>

        {projects.length > 0 && (
          <label className="history-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              placeholder="Find an experiment…"
              aria-label="Search experiment history"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={200}
            />
          </label>
        )}
        <div className="history-list" aria-busy={loading}>
          {error && (
            <div className="sidebar-error" role="alert">
              <p>{error}</p>
              <button className="text-button" type="button" onClick={onRefresh}>
                Retry history
              </button>
            </div>
          )}
          {loading && projects.length === 0 && (
            <div className="sidebar-empty">
              <Spinner label="Loading experiment history" />
              <p>Opening your lab…</p>
            </div>
          )}
          {!loading && !error && projects.length === 0 && (
            <div className="sidebar-empty">
              <div className="history-empty-mark">
                <FlaskConical size={22} aria-hidden="true" />
              </div>
              <strong>A fresh notebook.</strong>
              <p>
                Your experiments will live here.
                <br />
                Start with a question.
              </p>
            </div>
          )}
          {filtered.map((project) => (
            <button
              type="button"
              className={`history-item ${selectedId === project.id ? 'history-item-selected' : ''}`}
              key={project.id}
              onClick={() => navigate(() => onSelect(project.id))}
              aria-current={selectedId === project.id ? 'page' : undefined}
              title={project.question}
            >
              <span className="history-item-top">
                <span className="history-item-name">{project.name}</span>
                <span className={`history-indicator status-${project.status}`} aria-hidden="true" />
              </span>
              <span className="history-question">{project.question}</span>
              <span className="history-item-meta">
                <span>{project.mode === 'local' ? 'Rules-based' : 'Model-assisted'}</span>
                <span>{dateTime(project.updatedAt)}</span>
              </span>
              <span className="sr-only">
                <StatusBadge status={project.status} />
              </span>
            </button>
          ))}
          {query && filtered.length === 0 && (
            <div className="sidebar-empty">
              <p>No experiment matches “{query}”.</p>
            </div>
          )}
          {total > projects.length && (
            <p className="history-limit">
              Showing the {projects.length} most recent of {total} experiments.
            </p>
          )}
        </div>

        <div className="sidebar-bottom">
          <div className="local-status">
            <span className={`connection-dot ${config ? 'connected' : ''}`} aria-hidden="true" />
            <span>{config ? 'Local workspace' : 'Connecting to backend'}</span>
            <span className="local-status-tag">LOCAL</span>
          </div>
          <div className="privacy-note">
            <ShieldCheck size={15} aria-hidden="true" />
            <p>Rules-based runs stay on this machine. You choose if a model is used.</p>
          </div>
        </div>
      </aside>
    </>
  );
}
