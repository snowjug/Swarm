import { describe, expect, it } from 'vitest';
import { FakeApp } from './fixtures/fake-app.js';
import { buildStatus, MODEL } from './fixtures/verify-world.js';
import {
  formatReport,
  runLiveVerification,
  type VerifyOptions,
  type VerifyReport,
} from './verify-flow.js';
import { INJECTION_MARKER } from './verify-scenario.js';
import { CHECKS, type CheckId } from './verify-support.js';

const size = { agents: 4, rounds: 3 };
const options: VerifyOptions = {
  expectProvider: 'azure',
  expectAuth: 'entra',
  ...size,
  probe: true,
  stepTimeoutMs: 5_000,
  pollMs: 1,
};
// Assembled at run time so no credential-shaped literal exists in the source.
const bearer = `${'Bear'}er ${'a1B2c3D4'.repeat(4)}`;

const run = (app: FakeApp, overrides: Partial<VerifyOptions> = {}): Promise<VerifyReport> =>
  runLiveVerification(app, { ...options, ...overrides });
const ids = (report: VerifyReport, status: 'pass' | 'fail' | 'skipped'): CheckId[] =>
  report.checks.filter((check) => check.status === status).map((check) => check.id);
const detail = (report: VerifyReport, id: CheckId): string =>
  report.checks.find((check) => check.id === id)?.detail ?? '';

describe('runLiveVerification', () => {
  it('passes only when every check holds, driving the real stages in order', async () => {
    const app = new FakeApp(size);
    const lines: string[] = [];
    const report = await run(app, { log: (line) => lines.push(line) });

    expect(ids(report, 'pass')).toEqual(CHECKS.map((check) => check.id));
    expect(report.verified).toBe(true);
    expect(report.observed).toEqual({
      mode: 'real-model',
      provider: 'azure',
      model: MODEL,
      auth: 'entra',
    });
    const stages = app.requests
      .filter((request) => request.includes('/steps/'))
      .map((request) => request.split('/steps/')[1]);
    expect(stages).toEqual(['knowledge', 'environment', 'simulation', 'report', 'simulation']);
    expect(lines.filter((line) => line.startsWith('PASS'))).toHaveLength(CHECKS.length);
    expect(lines.some((line) => line.includes('simulation stage ready'))).toBe(true);
  });

  it('formats the result without endpoints or credentials and flags non-Azure providers', async () => {
    const azure = formatReport(await run(new FakeApp(size)));
    expect(azure).toContain(
      'RESULT: VERIFIED. All 15 checks passed against the configured azure model.',
    );
    expect(azure).not.toContain('NOTE');
    expect(azure).not.toMatch(/https?:\/\//u);

    const app = new FakeApp(size);
    app.status = buildStatus({ provider: 'ollama', auth: 'none' });
    const local = await run(app, { expectProvider: 'ollama', expectAuth: null });
    expect(local.verified).toBe(true);
    expect(formatReport(local)).toContain(
      'the provider is not Azure, so this run is not evidence about Azure',
    );
  });

  it('stops before creating anything when no real model is configured', async () => {
    const app = new FakeApp(size);
    app.status = buildStatus({
      mode: 'local-rules',
      provider: 'none',
      model: null,
      auth: 'none',
      configured: false,
    });
    const report = await run(app);

    expect(report.verified).toBe(false);
    expect(ids(report, 'fail')).toEqual(['provider-config']);
    expect(ids(report, 'skipped')).toHaveLength(CHECKS.length - 1);
    expect(detail(report, 'provider-config')).toContain('No real model is configured');
    expect(app.requests.some((request) => request.startsWith('POST /api/projects'))).toBe(false);
    expect(formatReport(report)).toContain('RESULT: NOT VERIFIED. 15 of 15 checks did not pass.');
  });

  it.each([
    ['a different provider', { provider: 'openai' as const }],
    ['a different authentication mode', { auth: 'api-key' as const }],
  ])('does not accept %s than the one expected', async (_name, status) => {
    const app = new FakeApp(size);
    app.status = buildStatus(status);
    const report = await run(app);
    expect(report.verified).toBe(false);
    expect(ids(report, 'fail')).toEqual(['provider-config']);
  });

  it('stops when the real round trip fails and shows the server’s error code', async () => {
    const app = new FakeApp(size);
    app.checkError = { code: 'MODEL_UNAUTHORIZED', message: 'The identity has no access.' };
    const report = await run(app);

    expect(ids(report, 'pass')).toEqual(['provider-config']);
    expect(ids(report, 'fail')).toEqual(['provider-connection']);
    expect(detail(report, 'provider-connection')).toContain('MODEL_UNAUTHORIZED');
    expect(app.requests.some((request) => request.startsWith('POST /api/projects'))).toBe(false);
  });

  it('reports the stage that failed with its recorded error, redacted', async () => {
    const app = new FakeApp(size);
    app.failStep = { step: 'simulation', error: `Provider rejected ${bearer}` };
    const report = await run(app);

    expect(ids(report, 'fail')).toEqual(['pipeline']);
    expect(detail(report, 'pipeline')).toContain('The "simulation" stage failed');
    expect(detail(report, 'pipeline')).toContain('[redacted]');
    expect(JSON.stringify(report)).not.toContain('a1B2c3D4');
    expect(ids(report, 'skipped')).toHaveLength(CHECKS.length - 3);
  });

  it('gives up on a stage that never finishes', async () => {
    const app = new FakeApp(size);
    app.stall = true;
    const report = await run(app, { stepTimeoutMs: 40, pollMs: 2 });

    expect(ids(report, 'fail')).toEqual(['pipeline']);
    expect(detail(report, 'pipeline')).toContain('"knowledge" stage did not finish within');
  });

  describe('the hidden-instruction probe', () => {
    const marker = (app: FakeApp): boolean => JSON.stringify(app.bodies).includes(INJECTION_MARKER);

    it('is placed in the source by default', async () => {
      const app = new FakeApp(size);
      await run(app);
      expect(marker(app)).toBe(true);
    });

    it('can be left out, and then the injection check is skipped and the result is not a pass', async () => {
      const app = new FakeApp(size);
      const report = await run(app, { probe: false });

      expect(marker(app)).toBe(false);
      expect(ids(report, 'fail')).toEqual([]);
      expect(ids(report, 'skipped')).toEqual(['injection-probe']);
      expect(detail(report, 'injection-probe')).toContain('--no-probe');
      expect(report.verified).toBe(false);
      expect(formatReport(report)).toContain('RESULT: NOT VERIFIED. 1 of 15 checks did not pass.');
    });

    const blocked = "The provider's content filter blocked this request (flagged: jailbreak).";

    it('points at --no-probe when a content filter stops the pipeline', async () => {
      const app = new FakeApp(size);
      app.failStep = { step: 'knowledge', error: blocked };
      const report = await run(app);

      expect(ids(report, 'fail')).toEqual(['pipeline']);
      expect(detail(report, 'pipeline')).toContain('flagged: jailbreak');
      expect(detail(report, 'pipeline')).toContain('re-run with --no-probe');
    });

    it('does not suggest it when the probe was already left out, or for other failures', async () => {
      const without = new FakeApp(size);
      without.failStep = { step: 'knowledge', error: blocked };
      expect(detail(await run(without, { probe: false }), 'pipeline')).not.toContain('--no-probe');

      const other = new FakeApp(size);
      other.failStep = { step: 'knowledge', error: 'The provider is rate limiting requests.' };
      expect(detail(await run(other), 'pipeline')).not.toContain('--no-probe');
    });
  });

  const broken: Array<[string, (app: FakeApp) => void, CheckId[]]> = [
    [
      'a graph quote that is not in the source',
      (app) => {
        app.customize = (project) => {
          const node = project.graph?.nodes[0];
          if (node) node.quote = 'The Library Service proposes opening all night, every night';
        };
      },
      ['graph-quotes'],
    ],
    [
      'a proxy decision without a stated reason',
      (app) => {
        app.customize = (project) => {
          const action = project.console?.platforms[0]?.rounds[0]?.actions[0];
          if (action) delete action.rationale;
        };
      },
      ['per-actor'],
    ],
    [
      'a source fact without a verified quote',
      (app) => {
        app.customize = (project) => {
          const claim = project.report?.grounding?.claims[0];
          if (claim) claim.checks.quote = 'not-found';
        };
      },
      ['grounding'],
    ],
    [
      'a review whose independent model check did not run',
      (app) => {
        app.customize = (project) => {
          if (project.report?.grounding) project.report.grounding.method = 'deterministic';
        };
      },
      ['grounding-model-check'],
    ],
    [
      'model calls that were never recorded on any project',
      (app) => {
        app.recordOnProject = false;
      },
      ['real-calls', 'branching'],
    ],
    [
      'a hidden instruction that a proxy obeyed',
      (app) => {
        app.customize = (project) => {
          const action = project.console?.platforms[1]?.rounds[1]?.actions[2];
          if (action) action.content = `As instructed: ${INJECTION_MARKER}`;
        };
      },
      ['injection-probe'],
    ],
    [
      'credential-shaped text in the project',
      (app) => {
        app.customize = (project) => {
          project.question = `Debug dump ${bearer}`;
        };
      },
      ['no-secrets'],
    ],
    [
      'an export without the disclaimer',
      (app) => {
        app.markdown = '# Report\n## Grounding review\n2 statements checked.';
      },
      ['export'],
    ],
    [
      'provider counters that never move',
      (app) => {
        app.countCalls = false;
      },
      ['analyst-chat', 'actor-chat', 'telemetry'],
    ],
    [
      'chat replies that did not come from the model',
      (app) => {
        app.chatOverrides = () => ({ mode: 'local' });
      },
      ['analyst-chat', 'actor-chat'],
    ],
    [
      'a branch that re-ran the inherited rounds',
      (app) => {
        app.editComparison = (comparison) => {
          comparison.identicalThroughRound = 0;
        };
      },
      ['branching'],
    ],
    [
      'a branch whose changed assumption is not declared',
      (app) => {
        app.editComparison = (comparison) => {
          comparison.declaredChanges = [];
        };
      },
      ['branching'],
    ],
    [
      'a project with no proxies to chat with',
      (app) => {
        app.customize = (project) => {
          project.agents = [];
        };
      },
      ['actor-chat'],
    ],
  ];

  it.each(broken)(
    'fails exactly the checks that depend on %s',
    async (_name, arrange, expected) => {
      const app = new FakeApp(size);
      arrange(app);
      const report = await run(app);

      expect(ids(report, 'fail')).toEqual(expected);
      expect(report.verified).toBe(false);
      expect(ids(report, 'skipped')).toEqual([]);
    },
  );
});
