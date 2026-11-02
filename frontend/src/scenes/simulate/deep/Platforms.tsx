import { Rows3, Waves } from 'lucide-react';
import { Chip } from '../../../design/ui';
import { NETWORK_BLURB, PLATFORM_WHY } from './copy';
import { useDeep } from './context';
import {
  PLATFORM_STATUS,
  minutesText,
  plural,
  roundDetail,
  shareText,
  stanceText,
  type PlatformView,
} from './model';
import { Dial, SectionHead, ShareBar } from './parts';
import './platforms.css';

function Lane({ view, round }: { view: PlatformView; round: number }) {
  const { project, setPlatform, setTab, setRound, followInMemory } = useDeep();
  const minutesPerRound = project.console?.environment?.minutesPerRound ?? null;
  const status = view.run ? PLATFORM_STATUS[view.run.status] : null;
  const at = Math.min(round, view.saved);
  const detail =
    view.run && view.saved > 0
      ? roundDetail(view.rounds, project.agents, at, minutesPerRound)
      : null;
  const point = detail?.point ?? null;
  const open = (tab: 'rounds' | 'memory') => {
    setPlatform(view.id);
    setRound(at);
    if (tab === 'memory') followInMemory({});
    else setTab('rounds');
  };

  return (
    <article className="sw-deep-plat" data-platform={view.id} data-idle={!view.run || undefined}>
      <header className="sw-deep-plat__head">
        <h3 className="sw-deep-plat__name">{view.name}</h3>
        {status && (
          <Chip tone={status.tone} dot={status.live} size="sm">
            {status.label}
          </Chip>
        )}
      </header>
      <p className="sw-deep-plat__blurb">{NETWORK_BLURB[view.id]}</p>

      {!view.run ? (
        <p className="sw-deep-plat__none">
          {view.planned
            ? 'Selected in the environment. No run has been returned for it yet.'
            : 'Not selected in this environment. Turn it on in the setup before the simulation starts.'}
        </p>
      ) : view.saved === 0 ? (
        <p className="sw-deep-plat__none">No round has been saved on this platform yet.</p>
      ) : (
        <>
          <div className="sw-deep-plat__mean">
            <span className="sw-numeral sw-deep-plat__value num">
              {point ? stanceText(point.mean) : '—'}
            </span>
            <span className="sw-deep-plat__caption">
              mean inclination
              <Dial value={point?.mean ?? 0} size="lg" />
            </span>
          </div>
          <div className="sw-deep-plat__shares">
            <ShareBar
              against={point?.opposition ?? 0}
              undecided={point ? point.undecided : 1}
              favour={point?.support ?? 0}
              label={
                point
                  ? `Against ${shareText(point.opposition)}, undecided ${shareText(point.undecided)}, in favour ${shareText(point.support)}`
                  : 'No shares recorded at the start'
              }
            />
            <p className="sw-deep-plat__legend num">
              {point ? (
                <>
                  <span className="sw-deep-key sw-deep-key--against">
                    Against {shareText(point.opposition)}
                  </span>
                  <span className="sw-deep-key sw-deep-key--undecided">
                    Undecided {shareText(point.undecided)}
                  </span>
                  <span className="sw-deep-key sw-deep-key--favour">
                    In favour {shareText(point.support)}
                  </span>
                </>
              ) : (
                <span>The shares are recorded from round 1.</span>
              )}
            </p>
          </div>
          <p className="sw-deep-plat__meta">
            {at === 0 ? 'Start' : `Round ${at} of ${project.roundCount}`}
            {detail?.minute !== null && detail?.minute !== undefined
              ? ` · ${minutesText(detail.minute)}`
              : ''}
            {' · '}
            {plural(view.actions, 'action')} recorded in all
          </p>
          <div className="sw-deep-plat__links">
            <button type="button" className="sw-deep-link" onClick={() => open('rounds')}>
              <Waves size={14} aria-hidden="true" /> Look at the rounds
            </button>
            <button type="button" className="sw-deep-link" onClick={() => open('memory')}>
              <Rows3 size={14} aria-hidden="true" /> Read the memory
            </button>
          </div>
        </>
      )}
    </article>
  );
}

/** Each platform on its own, at the round chosen above: they differ in who a proxy hears, so they are never added together. */
export function Platforms() {
  const { platforms, round } = useDeep();
  const shown = platforms.filter((view) => view.planned);
  if (shown.length === 0) return null;
  return (
    <section className="sw-deep-sec" aria-labelledby="deep-platforms">
      <SectionHead id="deep-platforms" title="Two platforms, kept apart" lead={PLATFORM_WHY} />
      <div className="sw-deep-plats">
        {shown.map((view) => (
          <Lane key={view.id} view={view} round={round} />
        ))}
      </div>
    </section>
  );
}
