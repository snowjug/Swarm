import { useState } from 'react';
import { Pin, Plus, X } from 'lucide-react';
import { Button, Field, IconButton, Input } from '../../design/ui';
import { LIMITS, MAX_CONTEXT_ASSUMPTIONS } from '../../lib/intake';
import { Surface } from './Surface';
import './Context.css';

function AssumptionsPanel({
  items,
  onChange,
  onClose,
  disabled,
}: {
  items: readonly string[];
  onChange: (items: string[]) => void;
  onClose: () => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState('');
  const full = items.length >= MAX_CONTEXT_ASSUMPTIONS;
  const add = () => {
    const statement = draft.trim().slice(0, LIMITS.assumption);
    if (!statement || full) return;
    if (!items.some((item) => item.toLowerCase() === statement.toLowerCase())) {
      onChange([...items, statement]);
    }
    setDraft('');
  };
  return (
    <div className="sw-ctx">
      <p className="sw-ctx__lead">What should Swarm take as given?</p>
      {items.length > 0 && (
        <ul className="sw-ctx__list" aria-label="Your assumptions">
          {items.map((item, index) => (
            <li key={`${index}-${item}`} className="sw-ctx__item">
              <span>{item}</span>
              <IconButton
                label={`Remove ${item}`}
                size="sm"
                disabled={disabled}
                onClick={() => onChange(items.filter((_, at) => at !== index))}
              >
                <X size={15} aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <form
        className="sw-ctx__add"
        onSubmit={(event) => {
          event.preventDefault();
          // The menu is drawn in a portal, but React still passes a submit up to the form of the composer that holds it:
          // adding an assumption must not be taken for asking the question.
          event.stopPropagation();
          add();
        }}
      >
        <Field label="Your assumption" labelHidden>
          <Input
            value={draft}
            maxLength={LIMITS.assumption}
            disabled={disabled || full}
            placeholder={full ? `At most ${MAX_CONTEXT_ASSUMPTIONS}` : 'Demand stays flat'}
            onChange={(event) => setDraft(event.target.value)}
          />
        </Field>
        <Button
          type="submit"
          size="md"
          variant="glass"
          icon={<Plus size={14} aria-hidden="true" />}
          disabled={disabled || full || !draft.trim()}
        >
          Add
        </Button>
      </form>
      <div className="sw-ctx__foot">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

/**
 * What the person takes as given, said before the question is read. Each becomes an assumption of the scenario, marked
 * as theirs, ahead of those the reading made; none of it is sent anywhere to be read.
 */
export function Assumptions({
  items,
  onChange,
  disabled,
}: {
  items: readonly string[];
  onChange: (items: string[]) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Surface
      title="Assumptions"
      width="24rem"
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          icon={<Pin size={16} aria-hidden="true" />}
          className={items.length > 0 ? 'is-set' : undefined}
          aria-label={items.length > 0 ? `Assumptions ${items.length}` : 'Assumptions'}
        >
          <span className="sw-hide-sm">Assumptions</span>
          {items.length > 0 && (
            <>
              {' '}
              <span className="sw-ask__badge num">{items.length}</span>
            </>
          )}
        </Button>
      }
    >
      <AssumptionsPanel
        items={items}
        onChange={onChange}
        onClose={() => setOpen(false)}
        disabled={disabled}
      />
    </Surface>
  );
}
