import { Plus, X } from 'lucide-react';
import type { Actor } from '../../../../shared/stakeholders';
import { Button, Field, IconButton, Input, Textarea } from '../../design/ui';

const MAX_LINES = 6;

type ListKey = 'objectives' | 'concerns' | 'constraints';

const LISTS: { key: ListKey; label: string; one: string }[] = [
  { key: 'objectives', label: 'Wants', one: 'want' },
  { key: 'concerns', label: 'Worries', one: 'worry' },
  { key: 'constraints', label: 'Pressure', one: 'pressure' },
];

/**
 * What an actor wants, fears and is pushed by, in the person's own words: the part of an actor that is wording, not a
 * number. Each line is the person's to change, add or take away; the numbers are on the traits. A change is held
 * with the others until they are saved, and the actor says it was edited by the person.
 */
export function WantsEditor({
  actor,
  onChange,
}: {
  actor: Actor;
  onChange: (next: Actor) => void;
}) {
  const set = (key: ListKey, lines: string[]) => onChange({ ...actor, [key]: lines });
  return (
    <div className="sw-wants">
      <Field label="Role" hint="What it does in this scenario, in a line.">
        <Input
          value={actor.role}
          maxLength={200}
          onChange={(event) => onChange({ ...actor, role: event.target.value })}
        />
      </Field>
      <Field label="Starting belief" hint="Where it stands before the change, in its own words.">
        <Textarea
          value={actor.priorBelief}
          maxLength={300}
          maxRows={4}
          onChange={(event) => onChange({ ...actor, priorBelief: event.target.value })}
        />
      </Field>
      {LISTS.map(({ key, label, one }) => {
        const lines = actor[key];
        return (
          <fieldset key={key} className="sw-wants__list">
            <legend className="sw-eyebrow">{label}</legend>
            {lines.map((line, index) => (
              <div key={index} className="sw-wants__line">
                <Input
                  value={line}
                  maxLength={200}
                  aria-label={`${label}: ${one} ${index + 1} of ${actor.name}`}
                  onChange={(event) =>
                    set(
                      key,
                      lines.map((item, at) => (at === index ? event.target.value : item)),
                    )
                  }
                />
                <IconButton
                  label={`Remove ${one} ${index + 1} of ${actor.name}`}
                  size="sm"
                  onClick={() =>
                    set(
                      key,
                      lines.filter((_, at) => at !== index),
                    )
                  }
                >
                  <X size={15} aria-hidden="true" />
                </IconButton>
              </div>
            ))}
            {lines.length < MAX_LINES && (
              <Button
                variant="ghost"
                size="sm"
                icon={<Plus size={14} aria-hidden="true" />}
                onClick={() => set(key, [...lines, ''])}
              >
                Add {one === 'pressure' ? 'a pressure' : `a ${one}`}
              </Button>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
