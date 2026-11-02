import { Flag, GitBranch, Rows3 } from 'lucide-react';
import type { Platform, SimulationMemory } from '../../../../../shared/guided';
import { Button, Chip } from '../../../design/ui';
import { actionLabel } from '../../../lib/console';
import { maxBranchRound } from '../../../lib/whatIf';
import { Avatar } from './Cast';
import { Heard, Sources } from './Cite';
import { useDeep } from './context';
import { changeText, minutesText, plural, shareText, stanceText, type RoundDetail } from './model';
import { Clamp, Figure, Position, StatedReason } from './parts';
import './inspector.css';

const points = (now: number, before: number | undefined): string | null => {
  if (before === undefined) return null;
  const diff = Math.round((now - before) * 100);
  return diff === 0 ? 'no change' : `${diff > 0 ? '+' : '\u2212'}${Math.abs(diff)} pts`;
};

/**
 * One round of one platform: the figures, who stood where and who did what. Round 0 is the start: the
 * assumed inputs and the initial inclinations, which is all that is recorded before the first round.
 */
export function Inspector({
  detail,
  platformName,
  platform,
  seeds,
  total,
  previousMean,
  onFollow,
}: {
  detail: RoundDetail;
  platformName: string;
  platform: Platform | null;
  seeds: readonly SimulationMemory[];
  total: number;
  previousMean: number | null;
  onFollow: (id: string | null) => void;
}) {
  const { project, controls, openProxy, openBranch, followInMemory } = useDeep();
  const local = project.mode === 'local';
  const { point, previous, round } = detail;
  const branchable = controls.branch && round <= maxBranchRound(project);
  const names = new Map(project.agents.map((agent) => [agent.id, agent.name]));

  return (
    <section className="sw-deep-insp" aria-labelledby="deep-insp-title">
      <header className="sw-deep-insp__head">
        <div>
          <h3 className="sw-deep-insp__title" id="deep-insp-title">
            {round === 0 ? 'The start' : `Round ${round}`}
            <span className="sw-deep-insp__of">
              {' '}
              {round === 0 ? 'before round 1' : `of ${total}`}
            </span>
          </h3>
          <p className="sw-deep-insp__meta">
            {platformName}
            {detail.minute !== null && round > 0
              ? ` · ${minutesText(detail.minute)} of scenario time in`
              : ''}
          </p>
        </div>
        <div className="sw-deep-insp__actions">
          {platform && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Rows3 size={15} aria-hidden="true" />}
              onClick={() => followInMemory({ round })}
            >
              Read it in the memory
            </Button>
          )}
          {branchable && (
            <Button
              variant="glass"
              size="sm"
              icon={<GitBranch size={15} aria-hidden="true" />}
              onClick={() => openBranch(round)}
            >
              Branch from {round === 0 ? 'the start' : `round ${round}`}
            </Button>
          )}
        </div>
      </header>

      {detail.intervention && (
        <div className="sw-deep-insp__event">
          <Flag size={18} aria-hidden="true" />
          <div>
            <p className="sw-deep-insp__event-title">
              The assumed event lands at the start of this round
            </p>
            <p className="sw-deep-insp__event-text">“{detail.intervention.label}”</p>
            <p className="sw-deep-insp__event-facts num">
              stance {stanceText(detail.intervention.stance)} · strength{' '}
              {detail.intervention.strength.toFixed(2)}
            </p>
          </div>
        </div>
      )}

      {point ? (
        <dl className="sw-deep-insp__figures">
          <Figure
            label="Mean inclination"
            value={stanceText(point.mean)}
            change={
              previousMean === null
                ? null
                : `${changeText(point.mean - previousMean)} vs ${round === 1 ? 'the start' : `round ${round - 1}`}`
            }
          />
          <Figure
            label="Against"
            value={shareText(point.opposition)}
            change={points(point.opposition, previous?.opposition)}
            hint="Proxies at −0.20 or lower"
          />
          <Figure
            label="Undecided"
            value={shareText(point.undecided)}
            change={points(point.undecided, previous?.undecided)}
            hint="Proxies between −0.20 and +0.20"
          />
          <Figure
            label="In favour"
            value={shareText(point.support)}
            change={points(point.support, previous?.support)}
            hint="Proxies at +0.20 or higher"
          />
          <Figure
            label="Polarization"
            value={point.polarization.toFixed(2)}
            change={previous ? changeText(point.polarization - previous.polarization) : null}
            hint="How far apart the proxies are: the spread of their inclinations"
          />
          <Figure
            label="Actions"
            value={String(point.actions)}
            hint="Posts, replies and updates; observing is not counted"
          />
          <Figure
            label="Heard"
            value={String(point.interactions)}
            change="peer exposures"
            hint="How many times a proxy heard another"
          />
        </dl>
      ) : round === 0 ? (
        <p className="sw-deep-fine">
          Nothing is recorded as a share or a spread before round 1. What is known is where each
          proxy starts, and the inputs they meet.
        </p>
      ) : (
        <p className="sw-deep-fine">No figures were saved for this round.</p>
      )}

      <div className="sw-deep-insp__cols">
        <div className="sw-deep-insp__col">
          <h4 className="sw-deep-insp__sub">Where each proxy stands</h4>
          {detail.proxies.length === 0 ? (
            <p className="sw-deep-fine">No positions were saved for this round.</p>
          ) : (
            <ul className="sw-deep-stands" role="list">
              {detail.proxies.map((proxy) => (
                <li key={proxy.id}>
                  <button
                    type="button"
                    className="sw-deep-stand"
                    onClick={() => openProxy(proxy.id)}
                    onPointerEnter={() => onFollow(proxy.id)}
                    onPointerLeave={() => onFollow(null)}
                    onFocus={() => onFollow(proxy.id)}
                    onBlur={() => onFollow(null)}
                    aria-haspopup="dialog"
                  >
                    <Avatar name={proxy.name} value={proxy.opinion} size="sm" />
                    <span className="sw-deep-stand__name">{proxy.name}</span>
                    <span className="sr-only">, inclination </span>
                    <Position value={proxy.opinion} word={false} />
                    <span className="sw-deep-stand__change num">
                      {proxy.change === null ? (
                        ''
                      ) : (
                        <>
                          <span className="sr-only">, change since the round before </span>
                          {changeText(proxy.change)}
                        </>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="sw-deep-insp__col">
          <h4 className="sw-deep-insp__sub">
            {round === 0 ? 'What they meet first' : 'What they did'}
          </h4>
          {round === 0 ? (
            seeds.length === 0 ? (
              <p className="sw-deep-fine">No seed input was recorded for this platform.</p>
            ) : (
              <ul className="sw-deep-dos" role="list">
                {seeds.map((seed) => (
                  <li className="sw-deep-do" key={seed.id}>
                    <p className="sw-deep-do__who">
                      <strong>Assumed input</strong>
                      {seed.opinion !== null && (
                        <span className="sw-deep-do__pos num">
                          stance {stanceText(seed.opinion)}
                        </span>
                      )}
                    </p>
                    <Clamp text={seed.text} lines={4} limit={220} />
                    <Sources ids={seed.sourceIds} />
                  </li>
                ))}
              </ul>
            )
          ) : detail.actions.length === 0 ? (
            <p className="sw-deep-fine">No actions were saved for this round.</p>
          ) : (
            <ul className="sw-deep-dos" role="list">
              {detail.actions.map((action) => (
                <li className="sw-deep-do" key={action.id}>
                  <p className="sw-deep-do__who">
                    <strong>{names.get(action.agentId) ?? action.agentId}</strong>
                    <Chip size="sm">{actionLabel(action.type, local)}</Chip>
                    <span className="sw-deep-do__pos num">→ {stanceText(action.opinion)}</span>
                  </p>
                  <Clamp text={action.content} lines={3} limit={180} />
                  <StatedReason rationale={action.rationale} confidence={action.confidence} />
                  <Heard ids={action.peerIds} />
                  <Sources ids={action.sourceIds} />
                </li>
              ))}
            </ul>
          )}
          {round > 0 && detail.actions.length > 0 && (
            <p className="sw-deep-fine">
              {plural(detail.actions.length, 'action')} recorded in this round.{' '}
              {local
                ? 'These are numeric rule transitions, not posts.'
                : 'These are fictional activity, not real posts.'}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
