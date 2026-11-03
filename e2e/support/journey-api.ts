import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { Analysis } from '../../shared/analysis';
import type { ConstraintsView } from '../../shared/constraints';
import type { CritiquesView } from '../../shared/critique';
import type { DecisionView } from '../../shared/decision';
import type { ResearchView } from '../../shared/research';
import type { ProjectDetail } from '../../shared/types';

// What the server holds of a project, read the way the page reads it: as the person who is signed in in that browser.
// A spec says what it saw on the screen, and then, with these, what the record says; it never starts anything with them.

const get = async <T>(api: APIRequestContext, path: string): Promise<T> => {
  const response = await api.get(path);
  expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
};

/** The id of the project the address names. */
export function projectIdOf(page: Page): string {
  const id = new URL(page.url()).searchParams.get('project');
  if (!id) throw new Error(`No project in ${page.url()}`);
  return id;
}

export const projectOf = (api: APIRequestContext, id: string): Promise<ProjectDetail> =>
  get<ProjectDetail>(api, `/api/projects/${id}`);

export const researchOf = (api: APIRequestContext, id: string): Promise<ResearchView> =>
  get<ResearchView>(api, `/api/projects/${id}/research`);

export const constraintsOf = (api: APIRequestContext, id: string): Promise<ConstraintsView> =>
  get<ConstraintsView>(api, `/api/projects/${id}/constraints`);

export const decisionOf = (api: APIRequestContext, id: string): Promise<DecisionView> =>
  get<DecisionView>(api, `/api/projects/${id}/decision`);

export const critiquesOf = (api: APIRequestContext, id: string): Promise<CritiquesView> =>
  get<CritiquesView>(api, `/api/projects/${id}/critiques`);

/** The finished comparisons of a project, newest last as the server lists them. */
export async function analysesOf(
  api: APIRequestContext,
  id: string,
): Promise<{ id: string; status: string }[]> {
  return (
    await get<{ analyses: { id: string; status: string }[] }>(api, `/api/projects/${id}/analysis`)
  ).analyses;
}

export async function analysisOf(
  api: APIRequestContext,
  id: string,
  aid: string,
): Promise<Analysis> {
  return (await get<{ analysis: Analysis }>(api, `/api/projects/${id}/analysis/${aid}`)).analysis;
}

export interface Exported {
  status: number;
  headers: Record<string, string>;
  text: string;
}

/** The brief as it is handed over: Markdown, JSON or the printable page. */
export async function exportOf(
  api: APIRequestContext,
  id: string,
  format: 'md' | 'json' | 'html',
): Promise<Exported> {
  const response = await api.get(`/api/projects/${id}/brief/export?format=${format}`);
  return { status: response.status(), headers: response.headers(), text: await response.text() };
}

/** Every piece of text that the server says about a project, for a string that must be nowhere in it. */
export async function everythingSaidOf(
  api: APIRequestContext,
  id: string,
): Promise<Record<string, string>> {
  const paths: Record<string, string> = {
    research: `/api/projects/${id}/research`,
    stakeholders: `/api/projects/${id}/stakeholders`,
    actors: `/api/projects/${id}/actors`,
    constraints: `/api/projects/${id}/constraints`,
    scenario: `/api/projects/${id}/scenario`,
    analysis: `/api/projects/${id}/analysis`,
    decision: `/api/projects/${id}/decision`,
    brief: `/api/projects/${id}/brief`,
    critiques: `/api/projects/${id}/critiques`,
    ledger: `/api/projects/${id}/ledger`,
  };
  const said: Record<string, string> = {};
  for (const [name, path] of Object.entries(paths)) {
    const response = await api.get(path);
    said[name] = response.ok() ? await response.text() : '';
  }
  for (const format of ['md', 'json', 'html'] as const) {
    said[`export.${format}`] = (await exportOf(api, id, format)).text;
  }
  return said;
}
