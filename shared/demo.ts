/**
 * The recorded demonstration: one synthetic scenario and the two branches taken from it. The
 * identifiers are fixed so that restoring the demonstration always produces the same projects, and
 * so that the interface can tell which projects belong to the demonstration workspace.
 *
 * Everything in it is fictional. The sources are in docs/demo/larkholm-ferry.
 */
export interface DemoProject {
  id: string;
  /** Names the snapshot file in docs/demo/seed. */
  slug: string;
  role: 'base' | 'branch';
  title: string;
  summary: string;
}

export const DEMO_PROJECTS: readonly DemoProject[] = [
  {
    id: 'de300001-0000-4000-8000-000000000001',
    slug: 'larkholm-base',
    role: 'base',
    title: 'Larkholm electric ferry: operator notice',
    summary:
      'Six fictional stakeholders react to a battery-electric ferry, a 12% fare rise and a reduced winter timetable. An assumed operator notice arrives before round 4.',
  },
  {
    id: 'de300001-0000-4000-8000-000000000002',
    slug: 'larkholm-guarantee',
    role: 'branch',
    title: 'Branch: council guarantee',
    summary:
      'Rounds 1 to 3 are copied unchanged. Instead of the operator notice, an assumed council guarantee of six winter sailings and a 5% fare cap arrives before round 4.',
  },
  {
    id: 'de300001-0000-4000-8000-000000000003',
    slug: 'larkholm-no-notice',
    role: 'branch',
    title: 'Branch: no operator notice',
    summary:
      'Rounds 1 to 3 are copied unchanged and the scheduled operator notice is withdrawn, so the remaining rounds show how the scenario runs without it.',
  },
];

export const DEMO_IDS: ReadonlySet<string> = new Set(DEMO_PROJECTS.map((project) => project.id));

export function demoProject(id: string): DemoProject | undefined {
  return DEMO_PROJECTS.find((project) => project.id === id);
}
