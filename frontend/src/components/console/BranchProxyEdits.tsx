import type { Agent } from '../../../../shared/types';
import type { BranchInput } from '../../../../shared/guided';

export type ProxyEdit = NonNullable<BranchInput['agentEdits']>[number];

export function BranchProxyEdits({
  agents,
  edits,
  disabled,
  onChange,
}: {
  agents: Agent[];
  edits: ProxyEdit[];
  disabled: boolean;
  onChange: (edits: ProxyEdit[]) => void;
}) {
  const unused = agents.filter((agent) => !edits.some((edit) => edit.id === agent.id));
  const update = (index: number, patch: Partial<ProxyEdit>) =>
    onChange(edits.map((edit, position) => (position === index ? { ...edit, ...patch } : edit)));
  return (
    <fieldset className="branch-proxies view-stack" disabled={disabled}>
      <legend>Optional fictional proxy assumption edits ({edits.length}/24)</legend>
      <p className="field-help">
        Blank numeric fields inherit the checkpoint value. Each selected proxy needs at least one
        numeric edit. Population, identity and source links are unchanged.
      </p>
      {edits.map((edit, index) => (
        <div className="branch-proxy-row" key={index}>
          <div className="field">
            <label htmlFor={`branch-proxy-${index}`}>Fictional proxy {index + 1}</label>
            <select
              id={`branch-proxy-${index}`}
              value={edit.id}
              onChange={(event) => update(index, { id: event.target.value })}
            >
              {agents.map((agent) => (
                <option
                  key={agent.id}
                  value={agent.id}
                  disabled={edits.some(
                    (item, position) => position !== index && item.id === agent.id,
                  )}
                >
                  {agent.name}
                </option>
              ))}
            </select>
          </div>
          <div className="fields-grid three">
            {(
              [
                ['influence', 'Influence (0.1–2)', 0.1, 2],
                ['openness', 'Openness (0–1)', 0, 1],
                ['opinion', 'Inclination (−1 to +1)', -1, 1],
              ] as const
            ).map(([field, label, min, max]) => (
              <div className="field" key={field}>
                <label htmlFor={`branch-${index}-${field}`}>{label}</label>
                <input
                  id={`branch-${index}-${field}`}
                  type="number"
                  min={min}
                  max={max}
                  step={0.01}
                  value={edit[field] ?? ''}
                  placeholder="Inherit"
                  onChange={(event) => {
                    const next = { ...edit };
                    if (event.target.value === '') delete next[field];
                    else next[field] = Number(event.target.value);
                    onChange(edits.map((item, position) => (position === index ? next : item)));
                  }}
                />
              </div>
            ))}
          </div>
          <button
            className="text-button danger-text"
            type="button"
            onClick={() => onChange(edits.filter((_, position) => position !== index))}
          >
            Remove proxy edit {index + 1}
          </button>
        </div>
      ))}
      <button
        className="button button-secondary"
        type="button"
        disabled={!unused.length || edits.length >= 24 || disabled}
        onClick={() => {
          if (unused[0]) onChange([...edits, { id: unused[0].id }]);
        }}
      >
        Add proxy assumption edit
      </button>
      {(!unused.length || edits.length >= 24) && (
        <p className="field-help">
          Every available proxy is already selected, or the 24-edit limit has been reached.
          Duplicate proxy rows are not allowed.
        </p>
      )}
    </fieldset>
  );
}
