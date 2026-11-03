import { useId } from 'react';
import { TEMPLATES, type Template } from './templates';

/**
 * Where to start when the box is empty and so is the head: a few kinds of change, each a sentence with blanks that
 * is put in the box to be written over. "Custom" is the way to start from nothing.
 */
export function Starts({
  disabled,
  onTemplate,
  onCustom,
}: {
  disabled: boolean;
  onTemplate: (template: Template) => void;
  onCustom: () => void;
}) {
  const id = useId();
  return (
    <div className="sw-ask-starts">
      <p id={`${id}-lead`} className="sw-ask-starts__lead">
        Start from a template
      </p>
      <ul className="sw-ask__starts" role="list" aria-labelledby={`${id}-lead`}>
        {TEMPLATES.map((template) => (
          <li key={template.id}>
            <button
              type="button"
              className="sw-ask__start"
              disabled={disabled}
              onClick={() => onTemplate(template)}
            >
              {template.label}
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            className="sw-ask__start sw-ask__start--quiet"
            disabled={disabled}
            onClick={onCustom}
          >
            Custom
          </button>
        </li>
      </ul>
    </div>
  );
}
