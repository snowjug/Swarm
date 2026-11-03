import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, Field, Input, useToast } from '../../../design/ui';
import { classifySite } from '../../ask/research';
import { useGroundResearch } from './context';
import { addressFromInput, shortAddress } from './model';

/** What a person typed, as the intake of a run that starts from it. */
function intakeFor(raw: string) {
  const site = classifySite(raw);
  if (site.kind === 'domain') return { auto: true, domain: site.domain };
  if (site.kind === 'url') return { auto: true, url: site.url };
  return { auto: true };
}

/**
 * The way to name a site or a page. Where there is a run it is added to it, and where there is none it is where one
 * starts from. The server judges the address as it judges any other (private and local addresses are refused, a
 * site's robots.txt is kept to), and what it refuses is said here, beside the field.
 */
export function AddSource() {
  const research = useGroundResearch();
  const toast = useToast();
  const [text, setText] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  if (!research) return null;
  const { state, presence, controls, addField } = research;
  const starting = presence.kind === 'empty';
  if (!(starting ? controls.start : controls.add)) return null;

  const kind = starting ? 'start' : 'add-source';
  const refused = state.problem?.kind === 'add-source' ? state.problem.message : null;
  const working = state.working === kind;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (state.working) return;
    const parsed = addressFromInput(text);
    if ('problem' in parsed) {
      setLocal(parsed.problem);
      addField.current?.focus();
      return;
    }
    setLocal(null);
    const ok = starting
      ? await state.start({ intake: intakeFor(text) })
      : await state.addSource(parsed.address);
    if (!ok) return;
    setText('');
    toast({
      title: starting ? 'Research started' : 'Added',
      description: `${shortAddress(parsed.address)} is read within the limits.`,
      tone: 'success',
      duration: 3600,
    });
  };

  return (
    <form
      className="sw-research-add"
      onSubmit={(event) => void submit(event)}
      noValidate
      aria-labelledby="ground-research-add-title"
    >
      <h3 className="sw-research-sub" id="ground-research-add-title">
        {starting ? 'Or start from a site or page' : 'Add a site or page'}
      </h3>
      <div className="sw-research-add__row">
        <Field
          label="Site or page to add"
          labelHidden
          error={local ?? refused}
          className="sw-research-add__field"
        >
          <Input
            ref={addField}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setLocal(null);
            }}
            placeholder="example.org or a page address"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </Field>
        <Button
          type="submit"
          variant="glass"
          icon={<Plus size={16} aria-hidden="true" />}
          busy={working}
          disabled={state.working !== null}
        >
          {starting ? 'Start' : 'Add'}
        </Button>
      </div>
      <p className="sw-research-quiet sw-caption">
        Public web addresses only. A private or local address is refused, a site’s robots.txt is
        kept to, and what is read counts against the limits.
      </p>
    </form>
  );
}
