import {
  ArrowRight,
  ArrowUpRight,
  Boxes,
  FileText,
  FlaskConical,
  GitBranch,
  LockKeyhole,
  Plus,
  Sparkles,
} from 'lucide-react';
import type { ProjectSummary } from '../../../shared/types';
import { dateTime } from '../lib/format';
import { EmptyPanel, Notice, Spinner, StatusBadge } from './ui';

function OrbitalDiagram() {
  return (
    <div className="orbital-diagram" aria-hidden="true">
      <div className="diagram-grid" />
      <svg viewBox="0 0 480 380" fill="none" className="orbital-svg">
        <defs>
          <radialGradient id="orbital-glow">
            <stop stopColor="#56ddc2" stopOpacity=".13" />
            <stop offset="1" stopColor="#56ddc2" stopOpacity="0" />
          </radialGradient>
          <linearGradient
            id="orbital-line"
            x1="90"
            y1="70"
            x2="360"
            y2="330"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#6ee7ca" stopOpacity=".7" />
            <stop offset="1" stopColor="#9987e8" stopOpacity=".6" />
          </linearGradient>
        </defs>
        <circle cx="250" cy="189" r="174" fill="url(#orbital-glow)" />
        <ellipse
          cx="250"
          cy="189"
          rx="173"
          ry="120"
          stroke="#263a3b"
          strokeDasharray="4 7"
          transform="rotate(-24 250 189)"
        />
        <ellipse
          cx="250"
          cy="189"
          rx="117"
          ry="158"
          stroke="#263a3b"
          strokeDasharray="4 7"
          transform="rotate(-28 250 189)"
        />
        <path
          d="m102 120 148 69 117-87-43 183L250 189l-87 111-61-180Zm0 0 265-18M163 300l161-15M250 189l-32-135"
          stroke="url(#orbital-line)"
        />
        <circle cx="250" cy="189" r="47" fill="#112a28" stroke="#4ec8ae" strokeOpacity=".45" />
        <circle cx="250" cy="189" r="34" stroke="#58d8bb" strokeOpacity=".25" />
        <path
          d="m250 168 19 10.5v21L250 210l-19-10.5v-21l19-10.5Zm0 0v42m-19-31.5 19 11 19-11"
          stroke="#8aebd4"
          strokeWidth="1.5"
        />
        {[
          { x: 102, y: 120, r: 17, color: '#7cdbc4' },
          { x: 367, y: 102, r: 22, color: '#9b8cda' },
          { x: 324, y: 285, r: 17, color: '#7cdbc4' },
          { x: 163, y: 300, r: 22, color: '#9b8cda' },
          { x: 218, y: 54, r: 10, color: '#7cdbc4' },
        ].map((node) => (
          <g key={node.x}>
            <circle
              cx={node.x}
              cy={node.y}
              r={node.r + 7}
              fill={node.color}
              fillOpacity=".035"
              stroke={node.color}
              strokeOpacity=".12"
            />
            <circle
              cx={node.x}
              cy={node.y}
              r={node.r}
              fill="#142023"
              stroke={node.color}
              strokeOpacity=".65"
            />
            <circle cx={node.x} cy={node.y} r="4" fill={node.color} />
          </g>
        ))}
      </svg>
      <div className="diagram-caption caption-source">
        <FileText size={13} /> Your sources
      </div>
      <div className="diagram-caption caption-persona">
        <Boxes size={13} /> Fictional agents
      </div>
      <div className="diagram-caption caption-dynamics">
        <GitBranch size={13} /> Emergent dynamics
      </div>
      <div className="diagram-label">AN EXPLORATION, NOT A PREDICTION</div>
    </div>
  );
}

export function Overview({
  projects,
  loading,
  historyError,
  onRefresh,
  onNew,
  onStarter,
  onSelect,
}: {
  projects: ProjectSummary[];
  loading: boolean;
  historyError: string | null;
  onRefresh: () => void;
  onNew: () => void;
  onStarter: () => void;
  onSelect: (id: string) => void;
}) {
  const steps = [
    {
      number: '01',
      title: 'Bring the context',
      body: 'Add your TXT or Markdown sources and frame a focused question.',
      icon: FileText,
    },
    {
      number: '02',
      title: 'Explore the dynamics',
      body: 'Watch fictional agents respond across a reproducible scenario.',
      icon: GitBranch,
    },
    {
      number: '03',
      title: 'Follow the evidence',
      body: 'Inspect the simulated outcomes, sources, and limitations.',
      icon: FlaskConical,
    },
  ];
  return (
    <div className="overview-page page-enter">
      <section className="welcome-hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="eyebrow-dot" /> YOUR LOCAL SCENARIO LAB
          </span>
          <h1>
            Make room for
            <br />
            <span>what if.</span>
          </h1>
          <p className="hero-description">
            Turn source material into a world you can explore. Build a scenario, observe fictional
            agents, and trace every insight back to its context.
          </p>
          <div className="hero-actions">
            <button className="button button-primary button-large" type="button" onClick={onNew}>
              <Plus size={18} aria-hidden="true" /> Create an experiment{' '}
              <ArrowRight size={17} aria-hidden="true" />
            </button>
            <button className="button button-ghost" type="button" onClick={onStarter}>
              Load starter scenario <ArrowUpRight size={15} aria-hidden="true" />
            </button>
          </div>
          <p className="hero-footnote">
            The starter fills fictional input only. Your results are never pre-made.
          </p>
        </div>
        <OrbitalDiagram />
      </section>

      <div className="capability-strip">
        <span>
          <LockKeyhole size={15} aria-hidden="true" /> Local-first by default
        </span>
        <span>
          <GitBranch size={15} aria-hidden="true" /> Reproducible, rules-based engine
        </span>
        <span>
          <Sparkles size={15} aria-hidden="true" /> Optional model assistance
        </span>
      </div>

      <section className="workflow-section" aria-labelledby="workflow-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">FROM CONTEXT TO CURIOSITY</span>
            <h2 id="workflow-heading">A small lab. A wider perspective.</h2>
          </div>
          <span className="quiet-label">THREE STEPS, YOUR QUESTION</span>
        </div>
        <div className="workflow-grid">
          {steps.map(({ number, title, body, icon: Icon }) => (
            <article className="workflow-card" key={number}>
              <div className="workflow-card-top">
                <span className="step-number">{number}</span>
                <Icon size={21} aria-hidden="true" />
              </div>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      {historyError && (
        <div className="overview-history-error">
          <Notice
            tone="error"
            title="Experiment history unavailable"
            action={
              <button
                className="button button-secondary button-small"
                type="button"
                onClick={onRefresh}
                disabled={loading}
              >
                Retry history
              </button>
            }
          >
            {historyError}{' '}
            {projects.length
              ? 'Previously loaded notebooks are shown below.'
              : 'An unavailable history does not mean your notebooks were deleted.'}
          </Notice>
        </div>
      )}
      {projects.length > 0 ? (
        <section className="recent-section" aria-labelledby="recent-heading">
          <div className="section-heading">
            <h2 id="recent-heading">Back to your notebook</h2>
            <span className="quiet-label">RECENT EXPERIMENTS</span>
          </div>
          <div className="recent-list">
            {projects.slice(0, 4).map((project) => (
              <button
                className="recent-project"
                type="button"
                key={project.id}
                onClick={() => onSelect(project.id)}
              >
                <span className="recent-icon">
                  <FlaskConical size={19} aria-hidden="true" />
                </span>
                <span className="recent-copy">
                  <strong>{project.name}</strong>
                  <span>{project.question}</span>
                </span>
                <StatusBadge status={project.status} />
                <span className="recent-date">{dateTime(project.updatedAt)}</span>
                <ArrowUpRight size={17} aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      ) : loading ? (
        <div className="loading-panel">
          <Spinner label="Loading recent experiments" />
          <span>Opening your experiment history…</span>
        </div>
      ) : historyError ? (
        <div className="overview-history-empty">
          <EmptyPanel
            title="Reconnect to see your notebooks"
            action={
              <button className="button button-secondary" type="button" onClick={onRefresh}>
                Retry connection
              </button>
            }
          >
            Check that the local backend is running. You can prepare a new scenario while the
            connection is unavailable.
          </EmptyPanel>
        </div>
      ) : (
        <section className="first-experiment-card">
          <div className="first-experiment-icon">
            <FlaskConical size={24} aria-hidden="true" />
          </div>
          <div>
            <h3>Your next question starts here.</h3>
            <p>No experiments yet. Add context, choose the rules, and see what unfolds.</p>
          </div>
          <button
            className="circle-button"
            type="button"
            onClick={onNew}
            aria-label="Create your first experiment"
          >
            <ArrowRight size={21} aria-hidden="true" />
          </button>
        </section>
      )}
      <p className="methodology-note">
        <span>KEEP THE RIGHT FRAME.</span> Simulations are tools for thinking, not scientifically
        validated forecasts. Fictional personas do not represent real people’s thoughts.
      </p>
    </div>
  );
}
