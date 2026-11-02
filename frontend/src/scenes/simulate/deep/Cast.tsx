import { ChevronLeft, ChevronRight, MessageCircle } from 'lucide-react';
import { useId } from 'react';
import type { ReactNode } from 'react';
import { useWorkspace } from '../../../app/context';
import {
  Button,
  Disclosure,
  Field,
  IconButton,
  Input,
  Sheet,
  SheetContent,
  Textarea,
} from '../../../design/ui';
import { cleanList } from '../../../lib/transparency';
import { stanceColor, stanceWord } from '../../../viz/palette';
import { PROXY_NOTE } from './copy';
import { vars } from './css';
import { useDeep } from './context';
import { SliderField } from './Fields';
import { Position } from './parts';
import { Sources } from './Cite';
import { PLATFORM_STATUS, stanceText } from './model';
import './cast.css';

/** A round mark with the first letter of a proxy's name, tinted by where it starts: never the only cue, the number is beside it. */
export function Avatar({
  name,
  value,
  size = 'md',
}: {
  name: string;
  value: number;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span
      className="sw-deep-avatar"
      data-size={size}
      aria-hidden="true"
      style={vars({ '--c': stanceColor(value, 0.6) })}
    >
      {name.trim().slice(0, 1).toUpperCase() || '?'}
    </span>
  );
}

/** The cast, one row for each proxy: who, where they start, and where they ended up once there is a run. */
export function Cast() {
  const { project, environment, openProxy } = useDeep();
  const hint = useId();
  const draft = environment.draft?.agents ?? null;
  const changed = new Set(environment.changes?.proxies ?? []);
  const ran = project.rounds.length > 0;
  const rows = draft
    ? draft.map((agent) => ({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        start: agent.initialOpinion,
        influence: agent.influence,
        openness: agent.openness,
      }))
    : project.agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        start: agent.initialOpinion,
        influence: agent.influence,
        openness: agent.openness,
      }));
  return (
    <>
      <p className="sr-only" id={hint}>
        {environment.editable ? 'Opens the proxy to read or to edit.' : 'Opens the proxy to read.'}
      </p>
      <ul className="sw-deep-cast" role="list">
        {rows.map((row) => {
          const now = project.agents.find((agent) => agent.id === row.id)?.opinion;
          return (
            <li key={row.id}>
              <button
                type="button"
                className="sw-deep-cast__row"
                onClick={() => openProxy(row.id)}
                aria-haspopup="dialog"
                aria-describedby={hint}
              >
                <Avatar name={row.name} value={row.start} />
                <span className="sw-deep-cast__who">
                  <span className="sw-deep-cast__name">
                    {row.name}
                    {changed.has(row.id) && (
                      <span className="sw-deep-cast__edited" title="Changed, not saved yet">
                        edited
                      </span>
                    )}
                  </span>
                  <span className="sw-deep-cast__role">{row.role}</span>
                </span>
                <span className="sw-deep-cast__facts">
                  <span className="sw-deep-cast__start">
                    <span className="sw-deep-cast__tag">Starts</span>
                    <Position value={row.start} word={false} />
                  </span>
                  {ran && now !== undefined && (
                    <span className="sw-deep-cast__start">
                      <span className="sw-deep-cast__tag">Now</span>
                      <Position value={now} word={false} />
                    </span>
                  )}
                  <span className="sw-deep-cast__traits num">
                    <span>influence {row.influence.toFixed(2)}</span>
                    <span>openness {row.openness.toFixed(2)}</span>
                  </span>
                </span>
                <ChevronRight className="sw-deep-cast__go" size={18} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Assumptions({
  goals,
  constraints,
}: {
  goals?: string[] | null;
  constraints?: string[] | null;
}) {
  const wants = cleanList(goals);
  const limits = cleanList(constraints);
  if (wants.length === 0 && limits.length === 0) return null;
  return (
    <div className="sw-deep-assume">
      <p className="sw-caption">Assumed by the model for this fictional proxy</p>
      {wants.length > 0 && (
        <>
          <h3 className="sw-eyebrow">Goals</h3>
          <ul role="list">
            {wants.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </>
      )}
      {limits.length > 0 && (
        <>
          <h3 className="sw-eyebrow">Constraints</h3>
          <ul role="list">
            {limits.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sw-deep-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * One proxy, to read, and to edit while the environment is still open. The edits go into the same draft
 * as the rest of the setup, and are saved together from the bar at the bottom of the page.
 */
export function ProxySheet({
  id,
  onOpen,
  onClose,
  onAsk,
}: {
  id: string;
  onOpen: (id: string) => void;
  onClose: () => void;
  /** The sheet closes into the Ask panel: whatever it does for focus on close, it does not do it here. */
  onAsk: () => void;
}) {
  const { project, environment, platforms } = useDeep();
  const ws = useWorkspace();
  const index = project.agents.findIndex((agent) => agent.id === id);
  const agent = project.agents[index];
  const at = environment.draft?.agents.findIndex((item) => item.id === id) ?? -1;
  const edit = at >= 0 ? environment.draft?.agents[at] : undefined;
  const editing = environment.editable && edit !== undefined && environment.draft !== null;
  const previous = project.agents[index - 1];
  const next = project.agents[index + 1];
  const fields = environment.check?.fields ?? {};

  const set = <K extends 'name' | 'role' | 'persona' | 'initialOpinion' | 'influence' | 'openness'>(
    key: K,
    value: NonNullable<typeof edit>[K],
  ) => {
    const draft = environment.draft;
    if (!draft || at < 0) return;
    environment.setDraft({
      ...draft,
      agents: draft.agents.map((item, position) =>
        position === at ? { ...item, [key]: value } : item,
      ),
    });
  };
  const problem = (key: string) => fields[`agents.${at}.${key}`];

  if (!agent) {
    return (
      <Sheet open onOpenChange={(open) => !open && onClose()}>
        <SheetContent title="Proxy not found" width="md">
          <p className="sw-caption">This proxy is not in the loaded project.</p>
        </SheetContent>
      </Sheet>
    );
  }
  const shown = edit ?? agent;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        eyebrow={`Fictional proxy · ${index + 1} of ${project.agents.length}`}
        title={shown.name}
        description={shown.role}
        width="md"
        className="sw-deep-proxy"
        footer={
          <>
            <div className="sw-deep-proxy__steps">
              <IconButton
                label="Previous proxy"
                size="md"
                disabled={!previous}
                onClick={() => previous && onOpen(previous.id)}
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </IconButton>
              <IconButton
                label="Next proxy"
                size="md"
                disabled={!next}
                onClick={() => next && onOpen(next.id)}
              >
                <ChevronRight size={18} aria-hidden="true" />
              </IconButton>
            </div>
            <Button
              variant="glass"
              icon={<MessageCircle size={16} aria-hidden="true" />}
              onClick={() => {
                ws.panels.ask({ target: agent.id });
                onAsk();
              }}
            >
              Ask {shown.name.split(' ')[0]}
            </Button>
          </>
        }
      >
        <div className="sw-deep-proxy__body">
          <p className="sw-deep-fine">
            An assumed simulation persona, not a real person. {PROXY_NOTE}
          </p>

          {editing && edit ? (
            <div className="sw-deep-proxy__form">
              <Field label="Name" error={problem('name')}>
                <Input
                  value={edit.name}
                  maxLength={100}
                  onChange={(event) => set('name', event.target.value)}
                />
              </Field>
              <Field label="Role" error={problem('role')}>
                <Input
                  value={edit.role}
                  maxLength={100}
                  onChange={(event) => set('role', event.target.value)}
                />
              </Field>
              <Field
                label="Persona assumptions"
                hint={`${edit.persona.trim().length} of 700 characters.`}
                error={problem('persona')}
              >
                <Textarea
                  value={edit.persona}
                  maxLength={700}
                  maxRows={9}
                  onChange={(event) => set('persona', event.target.value)}
                />
              </Field>
              <SliderField
                label="Initial inclination"
                value={edit.initialOpinion}
                min={-1}
                max={1}
                diverging
                words={(value) => `${stanceText(value)} · ${stanceWord(value, 0.5)}`}
                hint="−1 against, +1 in favour."
                error={problem('initialOpinion')}
                onChange={(value) => set('initialOpinion', value)}
              />
              <div className="sw-deep-proxy__pair">
                <SliderField
                  label="Influence"
                  value={edit.influence}
                  min={0.1}
                  max={2}
                  words={(value) => value.toFixed(2)}
                  hint="How far its voice carries: 0.1 to 2."
                  error={problem('influence')}
                  onChange={(value) => set('influence', value)}
                />
                <SliderField
                  label="Openness"
                  value={edit.openness}
                  min={0}
                  max={1}
                  words={(value) => value.toFixed(2)}
                  hint="How readily it is moved by what it hears: 0 to 1."
                  error={problem('openness')}
                  onChange={(value) => set('openness', value)}
                />
              </div>
              <p className="sw-deep-fine">
                Its identity, the topics it is linked to and its sources cannot be changed here.
              </p>
            </div>
          ) : (
            <>
              <p className="sw-read sw-deep-proxy__persona">{agent.persona}</p>
              <Assumptions goals={agent.goals} constraints={agent.constraints} />
              <dl className="sw-deep-facts-list">
                <Fact label="Starts at">
                  <Position value={agent.initialOpinion} />
                </Fact>
                {project.rounds.length > 0 && (
                  <Fact label="Recorded position">
                    <Position value={agent.opinion} />
                  </Fact>
                )}
                <Fact label="Influence">
                  <span className="num">{agent.influence.toFixed(2)}</span>
                </Fact>
                <Fact label="Openness">
                  <span className="num">{agent.openness.toFixed(2)}</span>
                </Fact>
              </dl>
              {platforms
                .filter((view) => view.run)
                .map((view) => {
                  const state = view.run?.agents.find((item) => item.id === agent.id);
                  return state ? (
                    <p className="sw-deep-proxy__where" key={view.id}>
                      <strong>{view.name}</strong> ·{' '}
                      {PLATFORM_STATUS[view.run!.status].label.toLowerCase()} at round {view.saved},
                      position <span className="num">{stanceText(state.opinion)}</span>
                    </p>
                  ) : null;
                })}
            </>
          )}

          <Sources ids={agent.sourceIds} label="Context from" />
          {agent.memory.length > 0 && (
            <Disclosure summary={`What it stored (${agent.memory.length})`}>
              <ul className="sw-deep-proxy__memory" role="list">
                {agent.memory.map((text, position) => (
                  <li key={position}>{text}</li>
                ))}
              </ul>
              <p className="sw-deep-fine">
                Private to this proxy: only its own prompts ever include it.
              </p>
            </Disclosure>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
