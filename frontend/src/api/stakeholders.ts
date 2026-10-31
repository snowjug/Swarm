import type {
  Actor,
  ActorsView,
  Stakeholder,
  StakeholderRelation,
  StakeholdersView,
} from '../../../shared/stakeholders';
import { jsonBody, request } from '../api';

const projectPath = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

/** The stakeholder and actor routes. Reading answers 200 with nothing for a project that has none. */
export const stakeholdersApi = {
  get: (id: string, signal?: AbortSignal) =>
    request<StakeholdersView>(`${projectPath(id)}/stakeholders`, { signal }),
  /** `rules` reads the text for roles; `model` asks the project's model. `confirm` replaces a reviewed list. */
  discover: (
    id: string,
    input: { mode: 'rules' | 'model'; confirm?: boolean },
    signal?: AbortSignal,
  ) =>
    request<StakeholdersView>(`${projectPath(id)}/stakeholders/discover`, {
      ...jsonBody(input),
      signal,
    }),
  save: (
    id: string,
    input: {
      stakeholders: Stakeholder[];
      relations: StakeholderRelation[];
      expectedRevision: number;
    },
    signal?: AbortSignal,
  ) =>
    request<StakeholdersView>(`${projectPath(id)}/stakeholders`, {
      ...jsonBody(input),
      method: 'PUT',
      signal,
    }),
  approve: (id: string, expectedRevision: number, signal?: AbortSignal) =>
    request<StakeholdersView>(`${projectPath(id)}/stakeholders/approve`, {
      ...jsonBody({ expectedRevision }),
      signal,
    }),
  actors: (id: string, signal?: AbortSignal) =>
    request<ActorsView>(`${projectPath(id)}/actors`, { signal }),
  makeActors: (id: string, input: { model?: boolean; confirm?: boolean }, signal?: AbortSignal) =>
    request<ActorsView>(`${projectPath(id)}/actors/generate`, { ...jsonBody(input), signal }),
  saveActors: (
    id: string,
    input: { actors: Actor[]; expectedRevision: number },
    signal?: AbortSignal,
  ) =>
    request<ActorsView>(`${projectPath(id)}/actors`, {
      ...jsonBody(input),
      method: 'PUT',
      signal,
    }),
};
