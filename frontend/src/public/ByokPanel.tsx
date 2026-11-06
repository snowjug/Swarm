import { useState, type FormEvent } from 'react';
import { CircleCheck, CircleX, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import { ApiError } from '../api';
import { Button, Dialog, DialogContent, Field, Input, Notice, Select } from '../design/ui';
import { FocusDialog } from '../panels/shared/FocusDialog';
import { usePanelLifecycle } from '../panels/shared/usePanelLifecycle';
import type { ByokConnectResult, ByokModel, ByokStatus } from '../../../shared/public';
import { clearByok, heldByokKey, keyProblem, setByokKey, setByokModel } from './byokStore';
import { NETWORK_WORDS } from './problems';
import { publicApi } from './publicApi';
import { useByok } from './useByok';

const BYOK_NOTICE =
  'Your key is used only for your requests and is never saved. Use a key with a spend limit.';

const FORGOTTEN_WORDS = {
  null: 'Your key was removed from this tab. Telling the server to drop its copy…',
  true: 'Your key was removed from this tab, and the server was told to drop its copy.',
  false:
    'Your key was removed from this tab. The server could not be told just now; it drops its copy by itself after a while.',
} as const;

const STATUS_WORDS: Record<ByokStatus, string> = {
  valid: 'Connected. Google accepted this key.',
  invalid:
    'Google did not accept this key. Check that you copied all of it, or make a new one in AI Studio.',
  'rate-limited': 'Your Google quota is used up for the moment. Wait a minute, then try again.',
  quota: 'Your Google quota or billing does not allow this. Check your plan in AI Studio.',
  region: "Google does not offer this key's service from where the server is. Try another key.",
  unreachable: 'We could not reach Google just now. Try again in a moment.',
  disabled: 'Using your own key is switched off right now.',
};

const STATUS_ICONS: Record<ByokStatus, LucideIcon> = {
  valid: CircleCheck,
  invalid: CircleX,
  'rate-limited': TriangleAlert,
  quota: TriangleAlert,
  region: TriangleAlert,
  unreachable: TriangleAlert,
  disabled: Info,
};

type Shown =
  | { kind: 'none' }
  | { kind: 'answer'; status: ByokStatus; message: string }
  | { kind: 'local'; message: string }
  /** The key is gone from the tab. `told` is whether the server has been told to drop its copy, or null while it is. */
  | { kind: 'forgotten'; told: boolean | null };

/** The server never repeats a key; this makes sure that nothing shown to the person could, whatever it said. */
function withoutKey(text: string, key: string): string {
  return key ? text.split(key).join('…') : text;
}

/** The model to use after a check: the one already chosen if the key can still use it, else the server's default. */
function pickModel(models: ByokModel[], defaultModel: string | null, chosen: string | null) {
  if (chosen && models.some((model) => model.id === chosen)) return chosen;
  if (defaultModel && (models.length === 0 || models.some((model) => model.id === defaultModel))) {
    return defaultModel;
  }
  return models[0]?.id ?? defaultModel ?? null;
}

function readAnswer(answer: ByokConnectResult, key: string): Shown {
  const status = answer.status in STATUS_WORDS ? answer.status : 'unreachable';
  const said = typeof answer.message === 'string' ? withoutKey(answer.message, key).trim() : '';
  return { kind: 'answer', status, message: said || STATUS_WORDS[status] };
}

/**
 * Where a person gives their own Google Gemini key, sees what Google said of it, picks a model, and takes it back. The
 * key is held by `byokStore` and shown only as its last four characters; what is typed is not kept anywhere once the
 * key has been connected.
 */
export function ByokPanel({
  open,
  onOpenChange,
  byokEnabled,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  byokEnabled: boolean;
  /** The key was connected or forgotten: what the page says about funding is read again. */
  onChanged: () => void;
}) {
  const lifecycle = usePanelLifecycle(open, onOpenChange, 'dialog');
  const { hasKey, hint, model, models } = useByok();
  const [draft, setDraft] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [shown, setShown] = useState<Shown>({ kind: 'none' });

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    if (connecting) return;
    const key = draft.trim() || heldByokKey() || '';
    const problem = keyProblem(key);
    if (problem) {
      setShown({ kind: 'local', message: problem });
      return;
    }
    setConnecting(true);
    try {
      const answer = await publicApi.connectByok(key);
      setShown(readAnswer(answer, key));
      if (answer.status === 'valid') {
        const list = Array.isArray(answer.models) ? answer.models : [];
        setByokKey(key, pickModel(list, answer.defaultModel, model), list);
        setDraft('');
        onChanged();
      }
    } catch (failure) {
      setShown({
        kind: 'local',
        message: failure instanceof ApiError ? withoutKey(failure.message, key) : NETWORK_WORDS,
      });
    } finally {
      setConnecting(false);
    }
  };

  const forget = async () => {
    // The key leaves the tab first, so that it is not sent again with the request that tells the server to drop its copy.
    clearByok();
    setDraft('');
    setShown({ kind: 'forgotten', told: null });
    onChanged();
    try {
      await publicApi.forgetByok();
      setShown({ kind: 'forgotten', told: true });
    } catch {
      // The server drops its copy by itself after a while; the person is told that it could not be asked.
      setShown({ kind: 'forgotten', told: false });
    }
  };

  const options =
    model && !models.some((entry) => entry.id === model)
      ? [{ id: model, label: model }, ...models]
      : models;
  const status =
    shown.kind === 'answer'
      ? shown.status
      : shown.kind === 'none'
        ? hasKey
          ? 'connected'
          : 'idle'
        : shown.kind;
  const StatusIcon =
    shown.kind === 'answer' ? STATUS_ICONS[shown.status] : hasKey ? CircleCheck : Info;
  const words =
    shown.kind === 'answer' || shown.kind === 'local'
      ? shown.message
      : shown.kind === 'forgotten'
        ? FORGOTTEN_WORDS[String(shown.told) as 'null' | 'true' | 'false']
        : hasKey
          ? 'A key is connected.'
          : '';

  return (
    <Dialog open={lifecycle.open} onOpenChange={lifecycle.onOpenChange}>
      <DialogContent
        title="Use your own Google key"
        description="Run Swarm on your own Google Gemini quota."
        className="sw-pub-dialog"
        footer={
          <Button variant="ghost" onClick={() => lifecycle.onOpenChange(false)}>
            Close
          </Button>
        }
      >
        <FocusDialog />
        <div className="sw-pub-byok" data-testid="byok-panel">
          {!byokEnabled && (
            <Notice tone="info">Using your own key is switched off right now.</Notice>
          )}
          <form className="sw-pub-byok__form" noValidate onSubmit={(event) => void connect(event)}>
            <Field
              label="Google Gemini API key"
              hint={
                <>
                  Paste the key here. You can make one in{' '}
                  <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                    Google AI Studio
                  </a>
                  .
                </>
              }
            >
              <Input
                type="password"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                data-testid="byok-key"
                placeholder={hasKey ? 'Paste a new key to replace this one' : undefined}
                value={draft}
                disabled={!byokEnabled || connecting}
                onChange={(event) => setDraft(event.target.value)}
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              data-testid="byok-connect"
              busy={connecting}
              busyLabel="Connecting"
              disabled={!byokEnabled || (!draft.trim() && !hasKey)}
            >
              {hasKey && !draft.trim() ? 'Check key again' : 'Connect'}
            </Button>
          </form>
          <div
            className="sw-pub-byok__status"
            role="status"
            data-testid="byok-status"
            data-status={status}
          >
            {words && (
              <>
                <StatusIcon size={16} aria-hidden="true" />
                <span>{words}</span>
              </>
            )}
          </div>
          {hasKey && (
            <div className="sw-pub-byok__held" data-testid="byok-held">
              <p>
                Key in use:{' '}
                <span className="sw-mono" data-testid="byok-hint">
                  {hint}
                </span>
              </p>
              {options.length > 0 && (
                <Field label="Model">
                  <Select
                    data-testid="byok-model"
                    value={model ?? ''}
                    onChange={(event) => setByokModel(event.target.value || null)}
                  >
                    {model === null && <option value="">The server chooses</option>}
                    {options.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Button
                variant="glass"
                size="sm"
                data-testid="byok-forget"
                onClick={() => void forget()}
              >
                Forget key
              </Button>
            </div>
          )}
          <p className="sw-pub-byok__notice" data-testid="byok-notice">
            {BYOK_NOTICE}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
