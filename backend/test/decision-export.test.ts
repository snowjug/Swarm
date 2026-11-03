import { afterEach, describe, expect, it } from 'vitest';
import { claimsAgainst } from '../../e2e/support/claims.js';
import { ANALYSIS_INPUTS } from '../../shared/analysis.js';
import type { DecisionCanvas } from '../../shared/decision.js';
import {
  actorSetFixture,
  analysisFixture,
  scenarioFixture,
  stakeholderSetFixture,
} from '../../shared/lab-fixtures.js';
import { APP_VERSION } from '../../shared/types.js';
import { buildApp } from '../src/app.js';
import { briefHtml, briefJson, briefMarkdown, type BriefExportInput } from '../src/brief/export.js';
import { buildBrief } from '../src/brief/build.js';
import { lintText } from '../src/brief/lint.js';
import { buildCanvas } from '../src/decision/build.js';
import { canvasBlocks } from '../src/decision/export.js';
import { fixtureInput, testConfig } from './fixtures.js';
import { baseInputs } from './support/brief-world.js';
import { OPTIONS, controlledInputs, sensitivityRow } from './support/decision-fixtures.js';

// The decision picture comes before the brief in everything that is handed over, and is handed over
// the way the rest is: escaped, with nothing that loads or runs.

type Application = Awaited<ReturnType<typeof buildApp>>;
const applications: Application[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

const WINNER = [
  OPTIONS.baseline(0.4, { favourable: 0.3 }),
  OPTIONS.proposed(0.2, { favourable: 0.6 }),
];
const canvasOf = (label = 'Proposed change'): DecisionCanvas =>
  buildCanvas(
    controlledInputs([WINNER[0]!, { ...WINNER[1]!, label }], {
      sensitivity: [sensitivityRow('small-move', 0.01)],
    }),
  );

const exportInput = (canvas: DecisionCanvas | null | undefined): BriefExportInput => ({
  brief: buildBrief(baseInputs()),
  visuals: null,
  project: { id: 'project-1', name: 'A decision' },
  exportedAt: '2026-03-01T10:00:00.000Z',
  appVersion: APP_VERSION,
  ...(canvas === undefined ? {} : { canvas }),
});

const ITEMS = [
  '1. Question',
  '2. Current best answer',
  '3. Most plausible futures',
  '4. What drives them',
  '5. Material constraints',
  '6. Who moves',
  '7. What could change the result',
  '8. Recommended next move',
  '9. What to validate before acting',
];

describe('the Markdown and the printable page open on the decision picture', () => {
  /** Markdown escapes its punctuation, which is its own business: what is read is what is left without it. */
  const plain = (text: string): string => text.replaceAll('\\', '');

  it('puts the nine items, in order, before the brief’s own answer', () => {
    const canvas = canvasOf();
    for (const text of [
      plain(briefMarkdown(exportInput(canvas))),
      briefHtml(exportInput(canvas)),
    ]) {
      const at = ITEMS.map((item) => text.indexOf(item));
      expect(
        at.every((position) => position > 0),
        text.slice(0, 200),
      ).toBe(true);
      expect(at).toEqual([...at].sort((a, b) => a - b));
      expect(text.indexOf('Decision view')).toBeLessThan(at[0]!);
      expect(text.indexOf('In short')).toBeGreaterThan(at[8]!);
    }
    const markdown = plain(briefMarkdown(exportInput(canvas)));
    expect(markdown.startsWith('# Decision brief: A decision')).toBe(true);
    expect(markdown).toContain('Explore scenarios, not predictions.');
    expect(markdown).toContain('Robust option');
  });

  it('says every statement’s kind beside it, and says what is missing instead of leaving it out', () => {
    const text = plain(briefMarkdown(exportInput(canvasOf())));
    expect(text).toMatch(/\*\*Recommendation\*\*/u);
    expect(text).toMatch(/\*\*Validation requirement\*\*/u);
    expect(text).toMatch(/\*\*Simulation event\*\*|\*\*Scenario possibility\*\*/u);
    expect(text).toMatch(
      /Whether it can be reversed: Unknown|Whether the choice can be reversed is unknown/u,
    );
    expect(text).toContain('Swarm recommends and explains. It does not contact anyone');
  });

  it('is unchanged when there is no canvas to put first', () => {
    const without = briefMarkdown(exportInput(undefined));
    expect(without).not.toContain('Decision view');
    expect(briefMarkdown(exportInput(null))).toBe(without);
    expect(briefHtml(exportInput(null))).not.toContain('id="decision-view"');
  });

  it('is held to the wording guards in every sentence it adds', () => {
    for (const block of canvasBlocks(canvasOf())) {
      const texts =
        block.kind === 'table'
          ? [block.caption, ...block.headers, ...block.rows.flat()]
          : [block.kind === 'heading' ? block.text : block.text];
      for (const text of texts) {
        expect(
          lintText(text).map((issue) => issue.rule),
          text,
        ).toEqual([]);
        expect(claimsAgainst(text), text).toEqual([]);
      }
    }
  });

  it('escapes what a person wrote, and keeps the page free of anything that loads or runs', () => {
    const hostile = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    const html = briefHtml(exportInput(canvasOf(hostile)));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<(?:link|iframe|object|embed)\b/u);
    expect(html.match(/<script/gu)).toBeNull();
    const markdown = briefMarkdown(exportInput(canvasOf(hostile)));
    expect(markdown).not.toContain('<script>');
  });
});

describe('the JSON export carries the canvas first and the brief after it', () => {
  it('has the canvas as data, ahead of the brief', () => {
    const canvas = canvasOf();
    const json = briefJson(exportInput(canvas)) as Record<string, unknown>;
    expect(Object.keys(json).indexOf('canvas')).toBeLessThan(Object.keys(json).indexOf('brief'));
    expect((json.canvas as DecisionCanvas).status.status).toBe('robust-option');
    expect((briefJson(exportInput(null)) as { canvas: unknown }).canvas).toBeNull();
  });
});

describe('what the export route hands over', () => {
  function seeded() {
    return buildApp({ config: testConfig({ LOG_LEVEL: 'silent' }) }).then((instance) => {
      applications.push(instance);
      const { repository } = instance;
      const project = repository.create(fixtureInput());
      const { artifacts } = repository;
      artifacts.put(project.id, 'scenario', 'default', scenarioFixture());
      artifacts.put(project.id, 'stakeholders', 'default', stakeholderSetFixture());
      artifacts.put(project.id, 'actors', 'default', actorSetFixture());
      const revisions = Object.fromEntries(
        ANALYSIS_INPUTS.map((kind) => [kind, artifacts.get(project.id, kind)?.revision ?? 0]),
      );
      artifacts.put(
        project.id,
        'analysis',
        'analysis-1',
        analysisFixture({ inputRevisions: revisions }),
      );
      return { ...instance, project };
    });
  }

  it('opens on the decision view in every format, and the canvas is the one the page shows', async () => {
    const { app, project } = await seeded();
    const base = `/api/projects/${project.id}`;
    expect(
      (await app.inject({ method: 'POST', url: `${base}/brief`, payload: {} })).statusCode,
    ).toBe(201);
    const view = (await app.inject({ method: 'GET', url: `${base}/decision` })).json() as {
      canvas: DecisionCanvas;
    };
    const md = (await app.inject({ method: 'GET', url: `${base}/brief/export?format=md` })).body;
    const html = (await app.inject({ method: 'GET', url: `${base}/brief/export?format=html` }))
      .body;
    const json = (
      await app.inject({ method: 'GET', url: `${base}/brief/export?format=json` })
    ).json() as {
      canvas: DecisionCanvas;
    };
    for (const text of [md, html]) {
      expect(text.indexOf('Decision view')).toBeGreaterThan(0);
      expect(text.indexOf('Decision view')).toBeLessThan(text.indexOf('In short'));
      expect(text).toContain(view.canvas.status.label);
    }
    expect(json.canvas).toEqual(view.canvas);
  });

  it('describes the comparison the brief is of, even when a newer one has finished since', async () => {
    const { app, project, repository } = await seeded();
    const base = `/api/projects/${project.id}`;
    await app.inject({ method: 'POST', url: `${base}/brief`, payload: {} });
    repository.artifacts.put(
      project.id,
      'analysis',
      'analysis-2',
      analysisFixture({ id: 'analysis-2', completedAt: '2026-04-01T10:00:00.000Z' }),
    );
    const json = (
      await app.inject({ method: 'GET', url: `${base}/brief/export?format=json` })
    ).json() as {
      canvas: DecisionCanvas;
      brief: { analysisId: string };
    };
    expect(json.brief.analysisId).toBe('analysis-1');
    expect(json.canvas.freshness.analysisId).toBe('analysis-1');
  });
});
