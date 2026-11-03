import type {
  ConstraintReviewInput,
  ConstraintsView,
  CounterfactualsView,
  GateView,
  ProposeConstraintsInput,
} from '../../../shared/constraints';
import { jsonBody, request } from '../api';

const base = (projectId: string): string =>
  `/api/projects/${encodeURIComponent(projectId)}/constraints`;

/** What a person sends to review the constraints: one action, against the revision they are looking at. */
export type ReviewAction = ConstraintReviewInput extends infer Action
  ? Action extends { expectedRevision: number }
    ? Omit<Action, 'expectedRevision'>
    : never
  : never;

/** What limits the decision: the constraints, the gate that says whether a simulation may start, and the views of the change. */
export const constraintsApi = {
  /** The constraints and the gate as they are now. A project that has none yet is not an error. */
  read: (projectId: string, signal?: AbortSignal) =>
    request<ConstraintsView>(base(projectId), { signal }),
  propose: (projectId: string, input: ProposeConstraintsInput, signal?: AbortSignal) =>
    request<ConstraintsView>(`${base(projectId)}/propose`, { ...jsonBody(input), signal }),
  review: (
    projectId: string,
    action: ReviewAction,
    expectedRevision: number,
    signal?: AbortSignal,
  ) =>
    request<ConstraintsView>(`${base(projectId)}/review`, {
      ...jsonBody({ ...action, expectedRevision }),
      signal,
    }),
  /** The gate worked out now, with the constraint whose removal moves the simulated result most. */
  gate: (projectId: string, signal?: AbortSignal) =>
    request<GateView>(`${base(projectId)}/gate`, { signal }),
  counterfactuals: (projectId: string, signal?: AbortSignal) =>
    request<CounterfactualsView>(`${base(projectId)}/counterfactuals`, { signal }),
  runCounterfactuals: (projectId: string, signal?: AbortSignal) =>
    request<CounterfactualsView>(`${base(projectId)}/counterfactuals`, {
      ...jsonBody({}),
      signal,
    }),
};
