/**
 * Which earlier events an event could not have done without.
 *
 * A responder's trigger reads a signal and never an event, so the engine only knows that an earlier
 * event had already landed on actors the responder watches (`followed`); an event moves a signal only
 * through the actors it lands on, and a signal that is high enough with or without it does not need it.
 * Whether it mattered is a question about a run that did not happen: the same seed, with that event's
 * responder switched off. This asks it. For each event and each earlier event it followed, the run is
 * replayed with the earlier responder made a non-responder (the engine decides who responds by an
 * actor's category and nothing else, and every random draw is addressed by actor, seed and member, so
 * nothing else about the run changes), and the earlier event is listed in `causedBy` only if the
 * responder then does not act by the round it did. If it still acts, or acts sooner, the earlier event
 * only came first and stays in `followed`.
 *
 * Only events that landed on actors a responder watches are tried. One that could have mattered only
 * through what other actors listen to is not, so a cause the replays do not find is not claimed.
 */
import type { RunOutcome, SimEvent, SimulationSpec } from '../../../shared/analysis.js';

/** The most replays one run is explained with, so that an unusually crowded cast cannot make it endless. */
export const MAX_REPLAYS = 24;

/** The same run, with one actor no longer an external responder. */
export const switchedOff = (spec: SimulationSpec, actorId: string): SimulationSpec => ({
  ...spec,
  actors: spec.actors.map((actor) =>
    actor.id === actorId ? { ...actor, category: 'other' as const } : actor,
  ),
});

/**
 * The run with each earlier event that an event could not do without moved from `followed` into
 * `causedBy`. `replay` runs the same seed on a changed spec, without trying to explain that run too.
 * What it costs is added to the run's work. A run with more links to test than `MAX_REPLAYS` is left as
 * it came and is not marked explained, so that `explained` always means that every earlier event an
 * event only followed was tried.
 */
export function explainEvents(
  outcome: RunOutcome,
  spec: SimulationSpec,
  replay: (changed: SimulationSpec) => RunOutcome,
): RunOutcome {
  const links = outcome.events.reduce((sum, event) => sum + (event.followed ?? []).length, 0);
  if (links > MAX_REPLAYS) return outcome;
  const byId = new Map(outcome.events.map((event) => [event.id, event]));
  let members = 0;
  let updates = 0;
  let replays = 0;
  const events = outcome.events.map((event): SimEvent => {
    const needed: string[] = [];
    const only: string[] = [];
    for (const id of event.followed ?? []) {
      const earlier = byId.get(id);
      if (!earlier?.actorId || !event.actorId) {
        only.push(id);
        continue;
      }
      const again = replay(switchedOff(spec, earlier.actorId));
      members += again.work.members;
      updates += again.work.updates;
      replays += 1;
      const acted = again.events.find((candidate) => candidate.actorId === event.actorId);
      (acted !== undefined && acted.round <= event.round ? only : needed).push(id);
    }
    return { ...event, causedBy: [...event.causedBy, ...needed], followed: only };
  });
  return {
    ...outcome,
    events,
    explained: true,
    work: {
      members: outcome.work.members + members,
      updates: outcome.work.updates + updates,
      ...(replays > 0 ? { replays } : {}),
    },
  };
}
