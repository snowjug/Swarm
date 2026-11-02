import { Lock } from 'lucide-react';
import { PLATFORMS } from '../../../../../shared/guided';
import type { Platform } from '../../../../../shared/guided';
import { Chip, EmptyState, Field, Select, Switch, Textarea } from '../../../design/ui';
import { stanceWord } from '../../../viz/palette';
import { platformNames } from '../../../lib/console';
import { MINUTES_NOTE, NETWORK_BLURB, PROXY_NOTE, SEED_NOTE } from './copy';
import { useDeep } from './context';
import { Sources } from './Cite';
import { Cast } from './Cast';
import { SliderField, Stepper } from './Fields';
import { Clamp, SectionHead } from './parts';
import { Prepare } from './States';
import { deepPhase, maxRoundsFor, minutesText, plural, stanceText } from './model';
import './setup.css';

const SEED_PLATFORM: Record<'both' | Platform, string> = {
  both: 'Both platforms',
  plaza: platformNames.plaza,
  community: platformNames.community,
};

function Timing() {
  const { project, environment } = useDeep();
  const { draft, check, editable, setDraft } = environment;
  if (!draft) return null;
  const fields = check?.fields ?? {};
  const rounds = Number.isFinite(draft.rounds) ? draft.rounds : 0;
  const minutes = Number.isFinite(draft.minutesPerRound) ? draft.minutesPerRound : 0;
  const toggle = (platform: Platform, on: boolean) => {
    const wanted = new Set(draft.platforms);
    if (on) wanted.add(platform);
    else wanted.delete(platform);
    setDraft({ ...draft, platforms: PLATFORMS.filter((item) => wanted.has(item)) });
  };
  return (
    <section className="sw-deep-sec" aria-labelledby="deep-timing">
      <SectionHead
        id="deep-timing"
        title="How it runs"
        lead="How many rounds, how long each lasts in the scenario, and where the proxies meet."
      />
      {editable ? (
        <div className="sw-deep-timing">
          <Stepper
            label="Rounds"
            value={draft.rounds}
            min={3}
            max={maxRoundsFor(project)}
            suffix="on each platform"
            error={fields.rounds}
            onChange={(value) => setDraft({ ...draft, rounds: value })}
          />
          <Stepper
            label="Minutes per round"
            value={draft.minutesPerRound}
            min={5}
            max={180}
            step={5}
            suffix="scenario minutes"
            error={fields.minutesPerRound}
            onChange={(value) => setDraft({ ...draft, minutesPerRound: value })}
          />
          <p className="sw-deep-timing__total">
            <span className="sw-numeral num">{minutesText(rounds * minutes)}</span>
            <span>of scenario time in all</span>
          </p>
        </div>
      ) : (
        <p className="sw-deep-timing__read">
          <span className="sw-numeral num">{draft.rounds}</span> rounds of{' '}
          <span className="sw-numeral num">{draft.minutesPerRound}</span> scenario minutes, on{' '}
          {draft.platforms.map((item) => platformNames[item]).join(' and ')}.
        </p>
      )}
      {editable && (
        <fieldset
          className="sw-deep-platform-pick"
          aria-describedby={fields.platforms ? 'deep-platform-error' : undefined}
        >
          <legend className="sw-deep-platform-pick__legend">Platforms to run</legend>
          <div className="sw-deep-platform-pick__grid">
            {PLATFORMS.map((platform) => (
              <Switch
                key={platform}
                label={platformNames[platform]}
                description={NETWORK_BLURB[platform]}
                checked={draft.platforms.includes(platform)}
                onChange={(event) => toggle(platform, event.target.checked)}
              />
            ))}
          </div>
          {fields.platforms && (
            <p className="sw-deep-sf__error" id="deep-platform-error" role="alert">
              {fields.platforms}
            </p>
          )}
        </fieldset>
      )}
      <p className="sw-deep-fine">{MINUTES_NOTE}</p>
    </section>
  );
}

function Seeds() {
  const { environment } = useDeep();
  const { draft, check, editable, setDraft } = environment;
  if (!draft) return null;
  const fields = check?.fields ?? {};
  const set = (index: number, patch: Partial<(typeof draft.initialPosts)[number]>) =>
    setDraft({
      ...draft,
      initialPosts: draft.initialPosts.map((post, at) =>
        at === index ? { ...post, ...patch } : post,
      ),
    });
  return (
    <section className="sw-deep-sec" aria-labelledby="deep-seeds">
      <SectionHead
        id="deep-seeds"
        title="Where they start"
        lead="The assumed inputs the proxies meet before round 1."
        aside={<Chip size="sm">{draft.initialPosts.length} recorded</Chip>}
      />
      {draft.initialPosts.length === 0 && (
        <p className="sw-deep-fine">No seed inputs were recorded for this environment.</p>
      )}
      <div className="sw-deep-seeds">
        {draft.initialPosts.map((post, index) => (
          <article className="sw-deep-seed" key={post.id}>
            <header className="sw-deep-seed__head">
              <p className="sw-eyebrow">Assumed input · {post.id}</p>
              {editable ? (
                <Field label="Where it is posted" labelHidden>
                  <Select
                    value={post.platform}
                    onChange={(event) =>
                      set(index, { platform: event.target.value as typeof post.platform })
                    }
                  >
                    {(['both', 'plaza', 'community'] as const).map((value) => (
                      <option key={value} value={value}>
                        {SEED_PLATFORM[value]}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <Chip size="sm">{SEED_PLATFORM[post.platform]}</Chip>
              )}
            </header>
            {editable ? (
              <>
                <Field
                  label="Seed text"
                  hint={`${post.text.trim().length} of 500 characters.`}
                  error={fields[`initialPosts.${index}.text`]}
                >
                  <Textarea
                    value={post.text}
                    maxLength={500}
                    maxRows={8}
                    onChange={(event) => set(index, { text: event.target.value })}
                  />
                </Field>
                <div className="sw-deep-seed__pair">
                  <SliderField
                    label="Assumed stance"
                    value={post.stance}
                    min={-1}
                    max={1}
                    diverging
                    words={(value) => `${stanceText(value)} · ${stanceWord(value, 0.5)}`}
                    error={fields[`initialPosts.${index}.stance`]}
                    onChange={(stance) => set(index, { stance })}
                  />
                  <SliderField
                    label="Assumed strength"
                    value={post.strength}
                    min={0}
                    max={1}
                    words={(value) => value.toFixed(2)}
                    error={fields[`initialPosts.${index}.strength`]}
                    onChange={(strength) => set(index, { strength })}
                  />
                </div>
              </>
            ) : (
              <>
                <Clamp text={post.text} lines={4} className="sw-deep-seed__text" />
                <p className="sw-deep-seed__facts num">
                  stance {stanceText(post.stance)} · strength {post.strength.toFixed(2)}
                </p>
              </>
            )}
            <Sources ids={post.sourceIds} />
          </article>
        ))}
      </div>
      <p className="sw-deep-fine">{SEED_NOTE}</p>
    </section>
  );
}

function Proxies() {
  const { project, environment } = useDeep();
  const made = project.console?.environment;
  const count = environment.draft?.agents.length ?? project.agents.length;
  return (
    <section className="sw-deep-sec" aria-labelledby="deep-cast">
      <SectionHead
        id="deep-cast"
        title="The cast"
        lead={
          environment.editable
            ? 'Fictional proxies. Open one to read it or to change it. Nothing is saved until you save.'
            : 'Fictional proxies. Open one to read it.'
        }
        aside={<Chip size="sm">{plural(count, 'proxy', 'proxies')}</Chip>}
      />
      <Cast />
      <p className="sw-deep-fine">
        {PROXY_NOTE}
        {made &&
          ` Prepared by ${made.generatedBy === 'local' ? 'local rules' : 'a model'}${made.edited ? ', with your edits saved' : ', not edited yet'}.`}
      </p>
    </section>
  );
}

/** What the run starts from: how long it is, where the proxies meet, what they are told, and who they are. */
export function Setup() {
  const { project, environment } = useDeep();
  const phase = deepPhase(project);
  if (phase === 'unprepared' || phase === 'preparing' || phase === 'prep-stopped')
    return <Prepare />;
  if (!environment.draft) {
    return (
      <EmptyState title="No environment was recorded" level={2}>
        The server returned no setup for this exploration. Reading it again may bring it back.
      </EmptyState>
    );
  }
  return (
    <div className="sw-deep-setup">
      {!environment.editable && (
        <p className="sw-deep-locked">
          <Lock size={15} aria-hidden="true" />
          {phase === 'ready'
            ? 'Editing pauses while the server is working.'
            : 'This is the setup the run started from. Editing closes when the simulation starts; branch a run to try another.'}
        </p>
      )}
      <Timing />
      <Seeds />
      <Proxies />
    </div>
  );
}
