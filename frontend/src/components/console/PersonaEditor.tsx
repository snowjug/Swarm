import type { EnvironmentUpdate } from '../../../../shared/guided';
import type { Agent } from '../../../../shared/types';
import type { Inspection } from '../../lib/graph';
import { signed } from '../../lib/format';
import { Citations } from './Citations';

type Persona = EnvironmentUpdate['agents'][number];

export function PersonaEditor({
  agent,
  source,
  disabled,
  onChange,
  onInspect,
}: {
  agent: Persona;
  source: Agent;
  disabled: boolean;
  onChange: (agent: Persona) => void;
  onInspect: (selection: Inspection) => void;
}) {
  const prefix = `persona-${agent.id}`;
  return (
    <details className="persona-card">
      <summary>
        <span className="proxy-avatar" aria-hidden="true">
          {agent.name.slice(0, 1)}
        </span>
        <span>
          <strong>{agent.name}</strong>
          <small>{agent.role}</small>
        </span>
        <span className="mono">{signed(agent.initialOpinion)}</span>
      </summary>
      <div className="persona-fields">
        <span className="eyebrow">FICTIONAL PROXY · {agent.id}</span>
        <div className="fields-grid">
          <div className="field">
            <label htmlFor={`${prefix}-name`}>Name</label>
            <input
              id={`${prefix}-name`}
              minLength={3}
              maxLength={100}
              value={agent.name}
              disabled={disabled}
              onChange={(event) => onChange({ ...agent, name: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={`${prefix}-role`}>Role</label>
            <input
              id={`${prefix}-role`}
              minLength={3}
              maxLength={100}
              value={agent.role}
              disabled={disabled}
              onChange={(event) => onChange({ ...agent, role: event.target.value })}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-persona`}>Persona assumptions</label>
          <textarea
            id={`${prefix}-persona`}
            rows={4}
            minLength={30}
            maxLength={700}
            value={agent.persona}
            disabled={disabled}
            onChange={(event) => onChange({ ...agent, persona: event.target.value })}
          />
        </div>
        <div className="fields-grid three">
          <div className="field">
            <label htmlFor={`${prefix}-inclination`}>Initial inclination</label>
            <input
              id={`${prefix}-inclination`}
              type="number"
              min={-1}
              max={1}
              step={0.01}
              value={agent.initialOpinion}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...agent, initialOpinion: Number(event.target.value) })
              }
            />
            <small>−1 oppose / +1 support</small>
          </div>
          <div className="field">
            <label htmlFor={`${prefix}-influence`}>Influence</label>
            <input
              id={`${prefix}-influence`}
              type="number"
              min={0.1}
              max={2}
              step={0.01}
              value={agent.influence}
              disabled={disabled}
              onChange={(event) => onChange({ ...agent, influence: Number(event.target.value) })}
            />
            <small>Assumption: 0.1–2</small>
          </div>
          <div className="field">
            <label htmlFor={`${prefix}-openness`}>Openness</label>
            <input
              id={`${prefix}-openness`}
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={agent.openness}
              disabled={disabled}
              onChange={(event) => onChange({ ...agent, openness: Number(event.target.value) })}
            />
            <small>Assumption: 0–1</small>
          </div>
        </div>
        <small className="mono muted">
          TOPIC LINKS {source.topicIds.length ? source.topicIds.join(', ') : 'NONE RECORDED'} ·
          IMMUTABLE
        </small>
        <Citations sourceIds={source.sourceIds} onInspect={onInspect} />
      </div>
    </details>
  );
}
