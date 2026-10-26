import { MessageSquare, Users } from 'lucide-react';
import type { ProjectDetail } from '../../../shared/types';
import { percent, signed } from '../lib/format';
import { EmptyPanel, SourceLinks } from './ui';

export function AgentsView({
  project,
  onSource,
  onInterview,
}: {
  project: ProjectDetail;
  onSource: (id: string) => void;
  onInterview: (id: string) => void;
}) {
  if (!project.agents.length) {
    return (
      <EmptyPanel
        title="Your cast has not been created yet"
        icon={<Users size={27} aria-hidden="true" />}
      >
        The persona stage creates fictional agents using the supplied context. No real people are
        being profiled.
      </EmptyPanel>
    );
  }
  return (
    <div className="view-stack">
      <div className="section-heading">
        <div>
          <span className="eyebrow">THE SCENARIO CAST</span>
          <h2>Different perspectives. Fictional people.</h2>
        </div>
        <span className="method-tag">{project.agents.length} SIMULATED AGENTS</span>
      </div>
      <p className="view-description">
        These personas are invented for this experiment. Their stances, traits, and memories are
        simulation state, not real-person thoughts or measured public opinion.
      </p>
      <div className="agent-grid">
        {project.agents.map((agent, index) => {
          const topics = agent.topicIds.map(
            (id) => project.graph?.nodes.find((node) => node.id === id)?.label ?? id,
          );
          return (
            <article className="card agent-card" key={agent.id}>
              <div className="agent-header">
                <span className={`agent-avatar avatar-tone-${index % 4}`} aria-hidden="true">
                  {agent.name
                    .split(/\s+/u)
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join('')}
                </span>
                <div>
                  <span className="eyebrow">FICTIONAL PERSONA</span>
                  <h3>{agent.name}</h3>
                  <p>{agent.role}</p>
                </div>
              </div>
              <p className="agent-persona plain-text">{agent.persona}</p>
              {topics.length > 0 && (
                <div className="topic-tags">
                  {topics.map((topic, topicIndex) => (
                    <span key={`${topic}-${topicIndex}`}>{topic}</span>
                  ))}
                </div>
              )}
              <div className="agent-stance">
                <div>
                  <span>Simulated stance</span>
                  <strong>{signed(agent.opinion)}</strong>
                </div>
                <meter
                  min={-1}
                  max={1}
                  value={agent.opinion}
                  aria-label={`${agent.name}'s simulated stance from minus one opposing to plus one supporting`}
                />
                <div className="stance-scale">
                  <span>Opposing</span>
                  <span>Supporting</span>
                </div>
                <p>
                  Initial {signed(agent.initialOpinion)} <span>→</span> Current{' '}
                  {signed(agent.opinion)}
                </p>
              </div>
              <div className="agent-parameters">
                <span>
                  Influence <strong>{percent(agent.influence)}</strong>
                </span>
                <span>
                  Openness <strong>{percent(agent.openness)}</strong>
                </span>
              </div>
              <p className="parameter-caption">Assumed simulation parameters, not probabilities.</p>
              <SourceLinks ids={agent.sourceIds} onOpen={onSource} />
              {agent.memory.length > 0 && (
                <details className="agent-memory">
                  <summary>
                    Recorded memory <span>{agent.memory.length}</span>
                  </summary>
                  <ol>
                    {agent.memory.map((memory, memoryIndex) => (
                      <li className="plain-text" key={memoryIndex}>
                        {memory}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              <button
                className="button button-secondary agent-interview"
                type="button"
                onClick={() => onInterview(agent.id)}
                disabled={project.status !== 'completed'}
              >
                <MessageSquare size={15} aria-hidden="true" />{' '}
                {project.mode === 'local'
                  ? 'Inspect persona evidence'
                  : 'Interview fictional persona'}
              </button>
            </article>
          );
        })}
      </div>
      {project.status !== 'completed' && (
        <p className="field-help">
          Evidence inspection and model-assisted interviews become available when the experiment is
          complete.
        </p>
      )}
    </div>
  );
}
