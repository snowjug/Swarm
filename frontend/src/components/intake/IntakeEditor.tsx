import { Plus, Trash2 } from 'lucide-react';
import { useId } from 'react';
import type { ScenarioFrame } from '../../../../shared/scenario';
import { LIMITS, edited, newId } from '../../lib/intake';
import { IntakeField, TextRows, VariableRows } from './IntakeRows';

/**
 * Every field of a scenario, as plain labelled controls. Whatever the person changes marks the whole
 * frame as theirs. Nothing here is required but what the server needs: the decision and the baseline.
 */
export function IntakeEditor({
  frame,
  disabled = false,
  onChange,
}: {
  frame: ScenarioFrame;
  disabled?: boolean;
  onChange: (frame: ScenarioFrame) => void;
}) {
  const id = useId();
  const set = (change: Partial<ScenarioFrame>) => onChange(edited(frame, change));
  const addAlternative = () =>
    set({
      alternatives: [
        ...frame.alternatives,
        {
          id: newId(
            'option',
            frame.alternatives.map((alternative) => alternative.id),
          ),
          label: '',
          description: '',
          changes: [],
        },
      ],
    });

  return (
    <div className="intake-editor">
      <fieldset className="intake-group" disabled={disabled}>
        <legend>The scenario</legend>
        <IntakeField
          id={`${id}-decision`}
          label="Decision or event"
          help="What is being decided, or what is supposed to happen."
          value={frame.decision}
          max={LIMITS.decision}
          multiline
          required
          onChange={(value) => set({ decision: value })}
        />
        <IntakeField
          id={`${id}-system`}
          label="What is affected"
          help="The market, organisation or system that the change reaches."
          value={frame.system}
          max={LIMITS.system}
          onChange={(value) => set({ system: value })}
        />
        <div className="intake-pair">
          <IntakeField
            id={`${id}-geography`}
            label="Where (optional)"
            value={frame.geography ?? ''}
            max={LIMITS.geography}
            onChange={(value) => set({ geography: value || null })}
          />
          <IntakeField
            id={`${id}-horizon`}
            label="Over what period (optional)"
            help="For example, the next two quarters."
            value={frame.horizon ?? ''}
            max={LIMITS.horizon}
            onChange={(value) => set({ horizon: value || null })}
          />
        </div>
      </fieldset>

      <fieldset className="intake-group" disabled={disabled}>
        <legend>What changes</legend>
        <p className="field-help">
          Each thing the change alters, with what it is now and what it becomes where you know.
        </p>
        <VariableRows
          rows={frame.changes}
          disabled={disabled}
          onChange={(changes) => set({ changes })}
        />
      </fieldset>

      <fieldset className="intake-group" disabled={disabled}>
        <legend>Without the change</legend>
        <IntakeField
          id={`${id}-baseline`}
          label="What is expected if nothing changes"
          help="Every alternative is compared with this."
          value={frame.baseline}
          max={LIMITS.baseline}
          multiline
          required
          onChange={(value) => set({ baseline: value })}
        />
      </fieldset>

      <fieldset className="intake-group" disabled={disabled}>
        <legend>Alternatives to compare</legend>
        <p className="field-help">
          Other ways the change could be made. Ones marked as suggestions were not in your question:
          edit or remove them.
        </p>
        {frame.alternatives.length === 0 && <p className="field-help">No alternatives listed.</p>}
        <ul className="intake-list">
          {frame.alternatives.map((alternative, index) => (
            <li key={alternative.id}>
              <div className="intake-card" role="group" aria-label={`Alternative ${index + 1}`}>
                <div className="intake-card-head">
                  <strong>Alternative {index + 1}</strong>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={disabled}
                    aria-label={`Remove alternative ${index + 1}${alternative.label ? `: ${alternative.label}` : ''}`}
                    onClick={() =>
                      set({
                        alternatives: frame.alternatives.filter(
                          (_, position) => position !== index,
                        ),
                      })
                    }
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
                <IntakeField
                  id={`${id}-alt-${alternative.id}-label`}
                  label="Name"
                  value={alternative.label}
                  max={LIMITS.label}
                  onChange={(value) =>
                    set({
                      alternatives: frame.alternatives.map((item, position) =>
                        position === index ? { ...item, label: value } : item,
                      ),
                    })
                  }
                />
                <IntakeField
                  id={`${id}-alt-${alternative.id}-description`}
                  label="Description (optional)"
                  value={alternative.description}
                  max={LIMITS.description}
                  multiline
                  onChange={(value) =>
                    set({
                      alternatives: frame.alternatives.map((item, position) =>
                        position === index ? { ...item, description: value } : item,
                      ),
                    })
                  }
                />
                <p className="intake-subhead">What this alternative changes</p>
                <VariableRows
                  rows={alternative.changes}
                  disabled={disabled}
                  onChange={(changes) =>
                    set({
                      alternatives: frame.alternatives.map((item, position) =>
                        position === index ? { ...item, changes } : item,
                      ),
                    })
                  }
                />
              </div>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="button button-secondary button-small"
          disabled={disabled || frame.alternatives.length >= LIMITS.alternatives}
          onClick={addAlternative}
        >
          <Plus size={14} aria-hidden="true" /> Add an alternative
        </button>
      </fieldset>

      <fieldset className="intake-group" disabled={disabled}>
        <legend>Who is likely to be affected</legend>
        <p className="field-help">
          Groups or roles the question names. Finding stakeholders starts from these and may add
          more.
        </p>
        <TextRows
          rows={frame.likelyStakeholders}
          noun="group"
          label="Group"
          max={LIMITS.stakeholders}
          maxLength={LIMITS.stakeholder}
          disabled={disabled}
          onChange={(likelyStakeholders) => set({ likelyStakeholders })}
        />
      </fieldset>

      <details className="intake-more">
        <summary>More detail (optional)</summary>
        <fieldset className="intake-group" disabled={disabled}>
          <legend>What you want from this</legend>
          <IntakeField
            id={`${id}-requested`}
            label="The decision to make"
            value={frame.requestedDecision ?? ''}
            max={LIMITS.requestedDecision}
            onChange={(value) => set({ requestedDecision: value || null })}
          />
          <IntakeField
            id={`${id}-output`}
            label="The result you want"
            value={frame.desiredOutput ?? ''}
            max={LIMITS.desiredOutput}
            onChange={(value) => set({ desiredOutput: value || null })}
          />
        </fieldset>

        <fieldset className="intake-group" disabled={disabled}>
          <legend>Evidence</legend>
          <p className="intake-subhead">Evidence you attached</p>
          {frame.evidenceAvailable.length === 0 ? (
            <p className="field-help">No documents were attached when the question was read.</p>
          ) : (
            <ul className="intake-plain">
              {frame.evidenceAvailable.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          )}
          <p className="intake-subhead">Evidence that would help and may be missing</p>
          <p className="field-help">
            General prompts: Swarm cannot tell from the question whether your documents cover them.
          </p>
          <TextRows
            rows={frame.evidenceMissing}
            noun="prompt"
            label="Missing evidence"
            max={LIMITS.missingEvidence}
            maxLength={LIMITS.missing}
            disabled={disabled}
            onChange={(evidenceMissing) => set({ evidenceMissing })}
          />
        </fieldset>

        <fieldset className="intake-group" disabled={disabled}>
          <legend>Assumptions</legend>
          <p className="field-help">
            What the reading assumed. Changing one makes it yours; it is then labelled as your
            assumption.
          </p>
          <ul className="intake-list">
            {frame.assumptions.map((assumption, index) => (
              <li key={assumption.id} className="intake-row intake-row-single">
                <div className="field">
                  <label htmlFor={`${id}-assumption-${assumption.id}`} className="sr-only">
                    Assumption {index + 1}
                  </label>
                  <input
                    id={`${id}-assumption-${assumption.id}`}
                    type="text"
                    autoComplete="off"
                    maxLength={LIMITS.assumption}
                    value={assumption.text}
                    onChange={(event) =>
                      set({
                        assumptions: frame.assumptions.map((item, position) =>
                          position === index
                            ? { ...item, text: event.target.value, origin: 'user' }
                            : item,
                        ),
                      })
                    }
                  />
                  <small className="field-help">
                    {assumption.origin === 'user' ? 'Your assumption' : 'Assumed by Swarm'}
                  </small>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  disabled={disabled}
                  aria-label={`Remove assumption ${index + 1}`}
                  onClick={() =>
                    set({
                      assumptions: frame.assumptions.filter((_, position) => position !== index),
                    })
                  }
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          {frame.assumptions.length === 0 && <p className="field-help">No assumptions listed.</p>}
          <button
            type="button"
            className="button button-secondary button-small"
            disabled={disabled || frame.assumptions.length >= LIMITS.assumptions}
            onClick={() =>
              set({
                assumptions: [
                  ...frame.assumptions,
                  {
                    id: newId(
                      'assumption',
                      frame.assumptions.map((item) => item.id),
                    ),
                    text: '',
                    origin: 'user',
                  },
                ],
              })
            }
          >
            <Plus size={14} aria-hidden="true" /> Add an assumption
          </button>
        </fieldset>
      </details>
    </div>
  );
}
