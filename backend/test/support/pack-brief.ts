import type { Analysis } from '../../../shared/analysis.js';
import type { BriefView, DecisionBrief } from '../../../shared/brief.js';
import type { ExampleScenario } from '../../../shared/example-scenarios.js';
import type { ScenarioParseResult } from '../../../shared/scenario.js';
import type { StakeholdersView } from '../../../shared/stakeholders.js';
import { documentInputSchema, type ProjectDetail } from '../../../shared/types.js';
import { buildApp } from '../../src/app.js';
import { testConfig } from '../fixtures.js';

/**
 * The decision brief that the rules-mode pipeline writes for a question and its evidence, through the
 * same routes the pages use and with no model: read the question, make the project, find and approve
 * the stakeholders, make the actors, compare the scenarios, review the comparison, write the brief.
 */
export async function briefOfPack(
  pack: Pick<ExampleScenario, 'title' | 'question' | 'documents'>,
): Promise<DecisionBrief> {
  const { app } = await buildApp({
    config: testConfig({ LOG_LEVEL: 'silent', RATE_LIMIT_SCALE: '100' }),
  });
  try {
    const call = async (method: 'GET' | 'POST', url: string, payload?: object) => {
      const reply = await app.inject({ method, url, ...(payload ? { payload } : {}) });
      if (reply.statusCode >= 300)
        throw new Error(`${method} ${url}: ${reply.statusCode} ${reply.body}`);
      return reply.json() as unknown;
    };
    const { frame } = (await call('POST', '/api/scenario/parse', {
      question: pack.question,
      documents: pack.documents.map(({ name, content }) => ({ name, characters: content.length })),
    })) as ScenarioParseResult;
    const project = (await call('POST', '/api/projects', {
      name: pack.title,
      question: pack.question,
      workflow: 'guided',
      documents: pack.documents.map((document) => documentInputSchema.parse(document)),
      scenario: frame,
      settings: { mode: 'local', agentCount: 6, rounds: 4, seed: 42, network: 'community' },
    })) as ProjectDetail;
    const base = `/api/projects/${project.id}`;
    const found = (await call('POST', `${base}/stakeholders/discover`, {
      mode: 'rules',
    })) as StakeholdersView;
    await call('POST', `${base}/stakeholders/approve`, { expectedRevision: found.revision });
    await call('POST', `${base}/actors/generate`, {});
    const started = (await call('POST', `${base}/analysis`, {
      runsPerVariant: 12,
      baseSeed: 2024,
      sensitivity: true,
    })) as { analysis: Analysis };
    for (let attempt = 0; attempt < 3_000; attempt += 1) {
      const { analysis } = (await call('GET', `${base}/analysis/${started.analysis.id}`)) as {
        analysis: Analysis;
      };
      if (!['running', 'queued'].includes(analysis.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await call('POST', `${base}/critiques/run`, {});
    const { brief } = (await call('POST', `${base}/brief`, {})) as BriefView;
    if (!brief) throw new Error('No brief was written.');
    return brief;
  } finally {
    await app.close();
  }
}

/** Every piece of text in a brief that a reader is given, with where it is, so that each can be judged on its own. */
export function textsOfBrief(brief: DecisionBrief): { where: string; text: string }[] {
  const texts: { where: string; text: string }[] = [{ where: 'headline', text: brief.headline }];
  for (const section of brief.sections) {
    for (const statement of section.statements) {
      texts.push({ where: `${section.id}/${statement.id}`, text: statement.text });
    }
  }
  for (const recommendation of brief.recommendations) {
    const where = `recommendation/${recommendation.id}`;
    texts.push(
      { where: `${where}/text`, text: recommendation.text },
      { where: `${where}/validation`, text: recommendation.validation },
      { where: `${where}/horizon`, text: recommendation.horizon },
      { where: `${where}/owner`, text: recommendation.ownerFunction },
      ...recommendation.leadingIndicators.map((text, index) => ({
        where: `${where}/indicator-${index + 1}`,
        text,
      })),
    );
  }
  for (const check of brief.validationPlan) {
    for (const field of ['question', 'method', 'successSignal', 'duration'] as const) {
      texts.push({ where: `validation/${check.id}/${field}`, text: check[field] });
    }
  }
  brief.limitations.forEach((text, index) =>
    texts.push({ where: `limitation/${index + 1}`, text }),
  );
  brief.methodology.notes.forEach((text, index) =>
    texts.push({ where: `methodology/${index + 1}`, text }),
  );
  return texts;
}
