import type {
  DecisionAuthority,
  InfluenceLevel,
  ParticipantRole,
  ParticipantValidationView,
  ParticipantWhy,
  Stakeholder,
  StakeholderCategory,
  StakeholdersView,
} from '../../../shared/stakeholders';
import { jsonBody, request } from '../api';
import type { Shown } from './stakeholderFlows';
import { stakeholdersApi } from './stakeholders';

const projectPath = (id: string) => `/api/projects/${encodeURIComponent(id)}`;
const participantPath = (id: string, participantId: string) =>
  `${projectPath(id)}/stakeholders/${encodeURIComponent(participantId)}`;

/** The fields of a participant that a person may change: nothing else is accepted by the server. */
export interface ParticipantChanges {
  name?: string;
  participantRole?: ParticipantRole;
  category?: StakeholderCategory;
  description?: string;
  relevance?: string;
  directness?: Stakeholder['directness'];
  priority?: Stakeholder['priority'];
  populationSize?: number;
  impact?: { direction: Stakeholder['expectedImpact']['direction']; rationale: string };
  uncertainty?: { level: Stakeholder['uncertainty']['level']; reason: string };
  assumptions?: string[];
  objective?: string;
  incentives?: string[];
  pressures?: string[];
  constraints?: string[];
  concerns?: string[];
  influence?: InfluenceLevel;
  decisionAuthority?: DecisionAuthority;
  informationAccess?: string[];
  plausibleActions?: string[];
  prohibitedClaims?: string[];
}

export interface AddMissingInput {
  role: ParticipantRole;
  name: string;
  whyTheyMatter?: string;
  objective?: string;
}

/** The participant routes. Each change answers with the view of the stakeholders, review included. */
export const participantsApi = {
  /** `rules` reads the text for roles; `model` asks the project's model. `confirm` replaces a reviewed list. */
  propose: (
    id: string,
    input: { mode: 'rules' | 'model'; confirm?: boolean },
    signal?: AbortSignal,
  ) =>
    request<StakeholdersView>(`${projectPath(id)}/stakeholders/propose`, {
      ...jsonBody(input),
      signal,
    }),
  validation: (id: string, signal?: AbortSignal) =>
    request<ParticipantValidationView>(`${projectPath(id)}/stakeholders/validation`, { signal }),
  accept: (id: string, input: { expectedRevision: number; ids?: string[] }, signal?: AbortSignal) =>
    request<StakeholdersView>(`${projectPath(id)}/stakeholders/accept`, {
      ...jsonBody(input),
      signal,
    }),
  edit: (
    id: string,
    participantId: string,
    input: { expectedRevision: number; changes: ParticipantChanges },
    signal?: AbortSignal,
  ) =>
    request<StakeholdersView>(participantPath(id, participantId), {
      ...jsonBody(input),
      method: 'PATCH',
      signal,
    }),
  remove: (id: string, participantId: string, expectedRevision: number, signal?: AbortSignal) =>
    request<StakeholdersView>(
      `${participantPath(id, participantId)}?expectedRevision=${expectedRevision}`,
      { method: 'DELETE', signal },
    ),
  regenerate: (
    id: string,
    participantId: string,
    input: { expectedRevision: number; mode: 'rules' | 'model'; confirm?: boolean },
    signal?: AbortSignal,
  ) =>
    request<StakeholdersView>(`${participantPath(id, participantId)}/regenerate`, {
      ...jsonBody(input),
      signal,
    }),
  why: (id: string, participantId: string, signal?: AbortSignal) =>
    request<ParticipantWhy>(`${participantPath(id, participantId)}/why`, { signal }),
  mergeDuplicates: (
    id: string,
    input: { expectedRevision: number; groups?: { keep: string; merge: string[] }[] },
    signal?: AbortSignal,
  ) =>
    request<StakeholdersView>(`${projectPath(id)}/stakeholders/merge-duplicates`, {
      ...jsonBody(input),
      signal,
    }),
  addMissing: (
    id: string,
    input: AddMissingInput & { expectedRevision: number },
    signal?: AbortSignal,
  ) =>
    request<StakeholdersView>(`${projectPath(id)}/stakeholders/add-missing`, {
      ...jsonBody(input),
      signal,
    }),
};

/** A change to the participants, then the actors read again, since a changed list can leave them out of date. */
export async function thenActors(
  projectId: string,
  change: Promise<StakeholdersView>,
): Promise<Shown> {
  const view = await change;
  return { view, actors: await stakeholdersApi.actors(projectId) };
}
