import { CircleDashed, CircleDot, Pencil } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  STAKEHOLDER_CATEGORY_LABELS,
  type Actor,
  type Stakeholder,
  type TraitKey,
} from '../../../../shared/stakeholders';
import { Button, Chip, Disclosure, Segmented } from '../../design/ui';
import { clusterColour, clusterGroup, stanceWord } from '../../viz/palette';
import type { EcoNode } from '../../viz/ecosystem/model';
import { signed } from '../../lib/format';
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  UNCERTAINTY_LABELS,
  stakeholderOriginLabel,
} from '../../lib/stakeholders/labels';
import { describedFurther, whyLine } from '../../lib/stakeholders/review';
import { directionOfImpact } from '../../viz/ecosystem/model';
import { EvidenceQuotes } from './Evidence';
import { Confidence, Gauge, ImpactChip } from './parts';
import { Traits } from './Traits';
import { WantsEditor } from './WantsEditor';
import { NO_EVIDENCE, type Connection, type Party, type Subject } from './model';

const DIRECTION_WORD = {
  harmed: 'harmed',
  benefited: 'benefited',
  mixed: 'mixed',
  unclear: 'unclear',
} as const;
const INFLUENCE_WORD = (value: number): string =>
  value < 0.34 ? 'Low' : value < 0.67 ? 'Medium' : 'High';
const IMPACT_WORD = (value: number): string =>
  value <= -0.35
    ? 'Harmed'
    : value < -0.08
      ? 'Slightly harmed'
      : value <= 0.08
        ? 'Neutral'
        : value < 0.35
          ? 'Slightly benefits'
          : 'Benefits';
const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** The one assumption an actor leans on most: where it starts. The rest of what it assumes is on its traits. */
function keyAssumption(actor: Actor): string {
  const prior = actor.priorBelief.trim();
  if (prior) return prior;
  const reason = actor.uncertainty.reason.trim();
  return (
    reason.split(/(?<=[.!?])\s/u)[0] ?? 'Its traits are starting assumptions, not measurements.'
  );
}

function sizeLine(stakeholder: Stakeholder): string {
  return stakeholder.priority === 'key'
    ? 'Modelled as one actor.'
    : `Stands for about ${stakeholder.populationSize.toLocaleString('en-GB')}: a modelling assumption, not a count.`;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sw-fact">
      <span className="sw-fact__label">{label}</span>
      <span className="sw-fact__value">{children}</span>
    </div>
  );
}

function List({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="sw-insp__list">
      <h3 className="sw-eyebrow">{title}</h3>
      <ul>
        {items.map((text, index) => (
          <li key={index}>{text}</li>
        ))}
      </ul>
    </section>
  );
}

export interface PartyBodyProps {
  party: Party;
  /** Whether the map shows the stakeholders or the actors made from them: the detail follows it. */
  subject: Subject;
  nodes: ReadonlyMap<string, EcoNode>;
  connections: readonly Connection[];
  /** The person may change things, and nothing is being saved. */
  editable: boolean;
  /** The actor as it is being edited, and as it was last saved. */
  draft: Actor | null;
  stored: Actor | null;
  /** The stakeholder this one was merged into, if it was. */
  mergedInto: Stakeholder | null;
  onSelect: (id: string) => void;
  onPriority: (priority: Stakeholder['priority']) => void;
  onTrait: (key: TraitKey, value: number) => void;
  onActor: (next: Actor) => void;
  /** The name and kind are already shown above (in a sheet's own title). */
  bare?: boolean;
}

/**
 * One party, told as quickly as it can be: who it is, how the change lands on it, how sure Swarm is, then
 * what it rests on. The evidence and the reasons are one press away and are never hidden by omission: a
 * party that cites nothing says so in words.
 */
export function PartyBody({
  party,
  subject,
  nodes,
  connections,
  editable,
  draft,
  stored,
  mergedInto,
  onSelect,
  onPriority,
  onTrait,
  onActor,
  bare = false,
}: PartyBodyProps) {
  const { stakeholder, actor } = party;
  const [editing, setEditing] = useState(false);
  const asActor = (draft ?? actor) !== null && (subject === 'actors' || !stakeholder);
  const shown = asActor ? (draft ?? actor) : null;
  const category = (shown ?? stakeholder ?? actor)!.category;
  const group = clusterGroup(category);
  const removed = stakeholder?.status === 'removed';
  const name = shown?.name ?? stakeholder?.name ?? actor!.name;
  const kind = shown
    ? shown.kind === 'key'
      ? 'Key actor'
      : `Cohort of ${shown.sampleSize}`
    : (stakeholder?.priority ?? 'standard') === 'key'
      ? 'Key actor'
      : 'Cohort';
  const evidence = stakeholder?.evidence ?? shown?.evidence ?? actor?.evidence ?? [];
  const origin = stakeholder?.origin ?? 'rules';
  const assumed = stakeholder?.expectedImpact.origin ?? 'system-assumption';
  const direction = stakeholder
    ? stakeholder.expectedImpact.direction
    : shown
      ? directionOfImpact(shown.traits.impact.value, shown.traits.impact.spread)
      : 'unclear';
  const role = shown?.role ? shown.role : stakeholder ? whyLine(stakeholder) : (actor?.role ?? '');
  const further = stakeholder ? describedFurther(stakeholder) : '';

  return (
    <div className="sw-insp__content">
      <header className="sw-insp__head">
        {!bare && (
          <>
            <p className="sw-eyebrow sw-insp__kicker">
              <span
                className="sw-insp__dot"
                style={{ background: clusterColour(group.id) }}
                aria-hidden="true"
              />
              {STAKEHOLDER_CATEGORY_LABELS[category]} · {kind}
            </p>
            <h2 className="sw-insp__name" tabIndex={-1} data-stk-focus="inspector">
              {name}
            </h2>
          </>
        )}
        {role && <p className="sw-insp__role">{role}</p>}
        <div className="sw-insp__chips">
          {stakeholder && removed && <Chip tone="neutral">{STATUS_LABELS.removed}</Chip>}
          {stakeholder && !removed && stakeholder.status !== 'proposed' && (
            <Chip tone="accent">{STATUS_LABELS[stakeholder.status]}</Chip>
          )}
          {stakeholder && !removed && stakeholder.status === 'proposed' && (
            <Chip tone="caution">{STATUS_LABELS.proposed}</Chip>
          )}
          {shown?.edited && <Chip tone="accent">{STATUS_LABELS.edited}</Chip>}
        </div>
      </header>

      {removed && mergedInto && (
        <p className="sw-insp__note">Merged into {mergedInto.name}. It stays in the record.</p>
      )}

      {shown ? (
        <section className="sw-insp__gauges" aria-label="Where this actor stands">
          <Gauge
            label="Effect"
            value={shown.traits.impact.value}
            word={
              <>
                {IMPACT_WORD(shown.traits.impact.value)}{' '}
                <span className="sw-gauge__num sw-mono">{signed(shown.traits.impact.value)}</span>
              </>
            }
            ends={['Harmed', 'Benefits']}
            hint="How the change lands on them: −1 harms, 0 neither, 1 benefits."
          />
          <Gauge
            label="Stance"
            value={shown.traits.priorStance.value}
            word={
              <>
                {capital(stanceWord(shown.traits.priorStance.value, 1))}{' '}
                <span className="sw-gauge__num sw-mono">
                  {signed(shown.traits.priorStance.value)}
                </span>
              </>
            }
            ends={['Against', 'In favour']}
            hint="Where they stand before the change."
          />
          <Gauge
            label="Influence"
            value={shown.traits.influence.value}
            min={0}
            max={1}
            word={
              <>
                {INFLUENCE_WORD(shown.traits.influence.value)}{' '}
                <span className="sw-gauge__num sw-mono">
                  {shown.traits.influence.value.toFixed(2)}
                </span>
              </>
            }
            hint="How much others weigh what they do."
          />
          <Confidence level={shown.uncertainty.level} />
        </section>
      ) : stakeholder ? (
        <section className="sw-insp__facts" aria-label="About this stakeholder">
          <Fact label="Effect">
            <ImpactChip direction={direction} origin={assumed} />
          </Fact>
          <Fact label="Reach">
            <span className="sw-reach" data-direct={stakeholder.directness === 'direct'}>
              {stakeholder.directness === 'direct' ? (
                <CircleDot size={15} aria-hidden="true" />
              ) : (
                <CircleDashed size={15} aria-hidden="true" />
              )}
              {stakeholder.directness === 'direct' ? 'Direct' : 'Indirect'}
            </span>
          </Fact>
          <Fact label="Modelled as">
            {editable && !removed ? (
              <Segmented
                size="sm"
                label="Priority"
                value={stakeholder.priority}
                onChange={onPriority}
                options={(['key', 'standard', 'background'] as const).map((value) => ({
                  value,
                  label: value === 'key' ? 'Key' : value === 'standard' ? 'Cohort' : 'Small',
                  hint: PRIORITY_LABELS[value],
                }))}
              />
            ) : (
              PRIORITY_LABELS[stakeholder.priority]
            )}
          </Fact>
          <Confidence level={stakeholder.uncertainty.level} />
        </section>
      ) : null}

      {shown && (
        <p className="sw-insp__assume">
          <CircleDashed size={15} aria-hidden="true" />
          <span>
            <strong>Key assumption.</strong> {keyAssumption(shown)}
          </span>
        </p>
      )}

      {shown && (
        <div className="sw-insp__wants">
          {editing && stored ? (
            <>
              <WantsEditor actor={shown} onChange={onActor} />
              <Button variant="glass" size="sm" onClick={() => setEditing(false)}>
                Done
              </Button>
            </>
          ) : (
            <>
              <List title="Wants" items={shown.objectives} />
              <List title="Worries" items={shown.concerns} />
              <List title="Pressure" items={[...shown.constraints, ...shown.dependencies]} />
              {(shown.objectives.length > 0 || shown.concerns.length > 0) && (
                <p className="sw-caption sw-insp__fine">
                  What it wants and fears is assumed from its category, or read by a model. It is
                  not found in the sources.
                </p>
              )}
              {editable && stored && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Pencil size={14} aria-hidden="true" />}
                  onClick={() => setEditing(true)}
                  className="sw-insp__edit"
                >
                  Edit what {shown.name} wants and fears
                </Button>
              )}
            </>
          )}
        </div>
      )}

      <div className="sw-insp__discs">
        <Disclosure
          defaultOpen={evidence.length > 0 && evidence.length <= 2}
          summary={
            <>
              Evidence <span className="sw-insp__count">{evidence.length}</span>
            </>
          }
        >
          <EvidenceQuotes evidence={evidence} empty={NO_EVIDENCE[origin]} />
        </Disclosure>

        {stakeholder && (
          <Disclosure summary="Why they are here">
            <div className="sw-insp__why">
              {stakeholder.relevance && !/Category default/u.test(stakeholder.relevance) && (
                <p>{stakeholder.relevance}</p>
              )}
              {further && <p>{further}</p>}
              <p>
                <strong>Expected effect.</strong> {capital(DIRECTION_WORD[direction])}
                {stakeholder.expectedImpact.rationale
                  ? `: ${stakeholder.expectedImpact.rationale}`
                  : '.'}
              </p>
              <p>
                <strong>{UNCERTAINTY_LABELS[stakeholder.uncertainty.level]}.</strong>{' '}
                {stakeholder.uncertainty.reason || 'No reason was given.'}
              </p>
              <p>{sizeLine(stakeholder)}</p>
              <p className="sw-caption">{stakeholderOriginLabel(stakeholder)}.</p>
              {stakeholder.assumptions.length > 0 && (
                <ul className="sw-insp__assumptions">
                  {stakeholder.assumptions.map((assumption, index) => (
                    <li key={index}>{assumption}</li>
                  ))}
                </ul>
              )}
              {stakeholder.mergedFrom.length > 0 && (
                <p className="sw-caption">
                  Merged from {stakeholder.mergedFrom.length} other stakeholder
                  {stakeholder.mergedFrom.length === 1 ? '' : 's'}; they stay in the record as
                  removed.
                </p>
              )}
            </div>
          </Disclosure>
        )}

        {connections.length > 0 && (
          <Disclosure
            defaultOpen
            summary={
              <>
                Connections <span className="sw-insp__count">{connections.length}</span>
              </>
            }
          >
            <ul className="sw-insp__links">
              {connections.slice(0, 12).map((link) => {
                const other = nodes.get(link.otherId);
                if (!other) return null;
                return (
                  <li key={link.edgeId}>
                    <button
                      type="button"
                      className="sw-insp__link"
                      onClick={() => onSelect(other.id)}
                    >
                      <span className="sw-insp__phrase">{link.phrase}</span>
                      <span className="sw-insp__who">{other.label}</span>
                      <span
                        className="sw-insp__strength"
                        aria-label={`strength ${Math.round(link.strength * 100)} of 100`}
                        style={{ '--s': link.strength } as React.CSSProperties}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          </Disclosure>
        )}

        {shown && stored && (
          <Disclosure
            summary={
              <>
                Traits <span className="sw-insp__count">11</span>
              </>
            }
          >
            <Traits
              actor={shown}
              stored={stored}
              disabled={!editable}
              onMove={onTrait}
              onChange={onActor}
            />
          </Disclosure>
        )}
      </div>
    </div>
  );
}
