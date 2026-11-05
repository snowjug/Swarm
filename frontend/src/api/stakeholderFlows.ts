import type {
  ActorsView,
  Stakeholder,
  StakeholderRelation,
  StakeholdersView,
} from '../../../shared/stakeholders';
import { withoutRulesUsed } from '../../../shared/model-failure';
import { constraintsApi } from './constraints';
import { stakeholdersApi } from './stakeholders';

/** What the page shows once a change is done: the list and the actors made from it. */
export interface Shown {
  view: StakeholdersView;
  actors: ActorsView;
}

/** Finds stakeholders, then reads the actors again, since a replaced list can leave them out of date. */
export async function discoverFlow(
  projectId: string,
  mode: 'rules' | 'model',
  confirm: boolean,
): Promise<Shown> {
  const view = await stakeholdersApi.discover(projectId, { mode, confirm });
  return { view, actors: await stakeholdersApi.actors(projectId) };
}

/** Saves the reviewed list. A project with no list yet starts from revision 0, which builds one by hand. */
export async function saveFlow(
  projectId: string,
  current: StakeholdersView,
  stakeholders: Stakeholder[],
  relations: StakeholderRelation[],
): Promise<Shown> {
  const view = await stakeholdersApi.save(projectId, {
    stakeholders,
    relations,
    expectedRevision: current.revision ?? 0,
  });
  return { view, actors: await stakeholdersApi.actors(projectId) };
}

/** What reading the constraints with the model, once the actors are made, came to. */
export interface ConstraintsRead {
  /**
   * `model`: the model's reading was used. `fallback`: the model could not be used and rules read them, so no model
   * proposed them. `skipped`: there already were constraints, and nothing was asked. `failed`: nothing was read.
   */
  outcome: 'model' | 'fallback' | 'skipped' | 'failed';
  /** How many constraints stand. */
  count: number;
  /** Why the model's reading did not stand, in the server's words; null when it did. */
  failure: string | null;
}

/**
 * Asks the model to propose the constraints of the decision, as the rest of the way through the Map: a project
 * that has some already is left as it is. What is proposed is unreviewed; a person confirms it under
 * Constraints before a simulation uses it. Rules read the sources whether or not the model could be used, so
 * the answer says which of them proposed what stands.
 */
export async function readConstraintsFlow(projectId: string): Promise<ConstraintsRead> {
  const held = await constraintsApi.read(projectId);
  if (held.constraints) {
    return { outcome: 'skipped', count: held.constraints.constraints.length, failure: null };
  }
  const proposed = (await constraintsApi.propose(projectId, { mode: 'model' })).constraints;
  const failure = proposed?.modelFailure ?? null;
  return {
    outcome: failure ? 'fallback' : 'model',
    count: proposed?.constraints.length ?? 0,
    failure: failure ? withoutRulesUsed(failure.detail) : null,
  };
}

/**
 * Approves the list, then makes the actors from it. Approving never replaces actors the person has
 * changed: those are left as they are, for the confirmed reset to replace. `approved` is told as soon
 * as the approval is stored, and whether the actors are about to be made.
 */
export async function approveFlow(
  projectId: string,
  current: StakeholdersView,
  actors: ActorsView | null,
  options: { model: boolean },
  approved: (view: StakeholdersView, making: boolean) => void,
): Promise<Shown> {
  if (current.revision === null) throw new Error('There are no stakeholders to approve.');
  const keeps = actors?.actors?.actors.some((actor) => actor.edited) ?? false;
  const view = await stakeholdersApi.approve(projectId, current.revision);
  approved(view, !keeps);
  if (keeps) return { view, actors: await stakeholdersApi.actors(projectId) };
  return {
    view,
    actors: await stakeholdersApi.makeActors(projectId, { model: options.model, confirm: false }),
  };
}
