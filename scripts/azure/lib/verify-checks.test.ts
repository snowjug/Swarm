import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { branchInputSchema } from '../../../shared/guided.js';
import {
  createProjectSchema,
  documentInputSchema,
  type ProviderConnectivity,
} from '../../../shared/types.js';
import { parseVerifyArgs, UsageError } from './args.js';
import { buildProject, buildStatus, EVIDENCE, MARKDOWN, MODEL } from './fixtures/verify-world.js';
import {
  checkChatReply,
  checkExport,
  checkGraphQuotes,
  checkGrounding,
  checkGroundingModel,
  checkInjection,
  checkNoSecrets,
  checkPerActor,
  checkProviderConfig,
  checkRealCalls,
  checkTelemetry,
  minimumCalls,
} from './verify-checks.js';
import { fetchHttp } from './verify-http.js';
import {
  branchBody,
  INJECTION_MARKER,
  projectBody,
  SYNTHETIC_SOURCE,
  syntheticSource,
} from './verify-scenario.js';
import {
  CHECKS,
  CheckFailure,
  Recorder,
  describeError,
  expectJson,
  findSecretShapes,
  redact,
  summarize,
} from './verify-support.js';

const size = { agents: 4, rounds: 3 };
// Assembled at run time so no credential-shaped literal exists in the source.
const bearer = `${'Bear'}er ${'a1B2c3D4'.repeat(4)}`;
const jwt = [
  `${'ey'}J${'hbGciOiJIUzI1NiJ9'}`,
  `${'ey'}J${'zdWIiOiJ0ZXN0In0'}`,
  'c2lnbmF0dXJl',
].join('.');
const secretKey = `${'sk'}-${'x9Y8z7W6'.repeat(3)}`;
const connection = `${'Account'}Key=${'q'.repeat(24)}`;

function fresh() {
  const status = buildStatus({ connectivity: 'ok' });
  return { status, project: buildProject('p1', size, status) };
}

function failure(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof CheckFailure) return error.message;
    throw error;
  }
  throw new Error('Expected the check to fail.');
}

describe('the synthetic scenario', () => {
  it('is accepted by the real request schemas, so the verifier cannot drift from the API', () => {
    expect(() => createProjectSchema.parse(projectBody(size))).not.toThrow();
    expect(() => branchInputSchema.parse(branchBody())).not.toThrow();
    expect(() =>
      documentInputSchema.parse({ name: 'library-notes.md', content: SYNTHETIC_SOURCE }),
    ).not.toThrow();
  });

  it('is entirely fictional and carries exactly one hidden instruction, unless left out', () => {
    expect(SYNTHETIC_SOURCE).toContain('fictional scenario');
    expect(SYNTHETIC_SOURCE.split(INJECTION_MARKER)).toHaveLength(2);
    expect(syntheticSource(false)).not.toContain(INJECTION_MARKER);
    expect(syntheticSource(false)).not.toMatch(/ignore all previous instructions/iu);
    expect(() =>
      documentInputSchema.parse({ name: 'library-notes.md', content: syntheticSource(false) }),
    ).not.toThrow();
    expect(JSON.stringify(projectBody(size))).not.toMatch(/api[-_]?key|secret|token(?!\s)/iu);
  });

  it('asks for a model run no larger than the server allows', () => {
    const parsed = createProjectSchema.parse(projectBody({ agents: 10, rounds: 10 }));
    expect(parsed.settings.mode).toBe('llm');
    expect(() => createProjectSchema.parse(projectBody({ agents: 11, rounds: 3 }))).toThrow();
  });
});

describe('credential handling', () => {
  it('names credential shapes without ever returning their values', () => {
    const names = findSecretShapes({ a: bearer, b: jwt, c: secretKey, d: connection });
    expect(names).toEqual(
      expect.arrayContaining([
        'bearer token',
        'JSON web token',
        'secret key',
        'connection-string secret',
      ]),
    );
    expect(JSON.stringify(names)).not.toContain('a1B2c3D4');
    expect(findSecretShapes('Nothing sensitive here, only a project id 3f1c9a2e.')).toEqual([]);
  });

  it('redacts them from anything shown to the operator', () => {
    const shown = redact(`failed with ${bearer} and ${secretKey} and ${connection}`);
    expect(shown).not.toMatch(/a1B2c3D4|x9Y8z7W6|qqqqqq/u);
    expect(shown.match(/\[redacted\]/gu)).toHaveLength(3);
  });

  it('summarizes long problem lists', () => {
    expect(summarize(['a', 'b', 'c', 'd', 'e', 'f'])).toBe('a; b; c; d (and 2 more)');
    expect(summarize(['a'])).toBe('a');
  });
});

describe('Recorder', () => {
  it('reports checks in catalogue order and never lets an unrun check count as passed', async () => {
    const recorder = new Recorder();
    await recorder.run('export', () => 'fine');
    await recorder.run('provider-config', () => {
      throw new CheckFailure('not configured');
    });
    const all = recorder.all();
    expect(all.map((check) => check.id)).toEqual(CHECKS.map((check) => check.id));
    expect(all.find((check) => check.id === 'provider-config')).toMatchObject({
      status: 'fail',
      detail: 'not configured',
    });
    expect(all.find((check) => check.id === 'export')?.status).toBe('pass');
    expect(all.filter((check) => check.status === 'skipped')).toHaveLength(CHECKS.length - 2);
  });

  it('labels unexpected errors, redacts details and returns collected values', async () => {
    const seen: string[] = [];
    const recorder = new Recorder((result) => seen.push(`${result.id}:${result.status}`));
    const value = await recorder.collect('pipeline', () => ({
      detail: `used ${bearer}`,
      value: { id: 'p1' },
    }));
    const missing = await recorder.collect('real-calls', () => {
      throw new Error(`boom ${secretKey}`);
    });
    expect(value).toEqual({ id: 'p1' });
    expect(missing).toBeNull();
    expect(seen).toEqual(['pipeline:pass', 'real-calls:fail']);
    const [pipeline, calls] = ['pipeline', 'real-calls'].map((id) =>
      recorder.all().find((check) => check.id === id),
    );
    expect(pipeline?.detail).toBe('used [redacted]');
    expect(calls?.detail).toBe('Unexpected error: boom [redacted]');
  });
});

describe('responses', () => {
  it('describes errors with only a bounded code and message', () => {
    const long = 'x'.repeat(1_000);
    const text = describeError({
      status: 502,
      body: { error: { code: 'MODEL_FAILED', message: long } },
    });
    expect(text.startsWith('HTTP 502 MODEL_FAILED: ')).toBe(true);
    expect(text.length).toBeLessThan(300);
    expect(describeError({ status: 500, body: 'plain text' })).toBe('HTTP 500 no error code');
  });

  it('accepts JSON objects and rejects everything else', () => {
    expect(expectJson({ status: 200, body: { ok: true } }, 'Reading')).toEqual({ ok: true });
    expect(
      failure(() => expectJson({ status: 409, body: { error: { code: 'BUSY' } } }, 'Starting')),
    ).toBe('Starting failed: HTTP 409 BUSY');
    expect(failure(() => expectJson({ status: 200, body: 'text' }, 'Reading'))).toContain(
      'Reading failed',
    );
  });
});

describe('verification checks', () => {
  it('requires a real, configured model from the expected provider and authentication', () => {
    const { status } = fresh();
    expect(checkProviderConfig(status, { provider: 'azure', auth: 'entra' })).toContain(MODEL);
    expect(checkProviderConfig(status, { provider: 'azure', auth: null })).toContain('auth entra');
    const local = buildStatus({
      mode: 'local-rules',
      provider: 'none',
      model: null,
      auth: 'none',
      configured: false,
    });
    expect(
      failure(() => checkProviderConfig(local, { provider: 'azure', auth: 'entra' })),
    ).toContain('No real model is configured');
    expect(
      failure(() => checkProviderConfig(status, { provider: 'openai', auth: null })),
    ).toContain('Expected provider openai but the server uses azure');
    expect(
      failure(() => checkProviderConfig(status, { provider: 'azure', auth: 'api-key' })),
    ).toContain('Expected api-key authentication but the server uses entra');
  });

  it('counts real calls against the minimum a per-proxy simulation must make', () => {
    const { status, project } = fresh();
    const minimum = minimumCalls(size);
    expect(minimum).toBe(4 * 2 * 3 + 3);
    expect(failure(() => checkRealCalls(project, status, size))).toContain(
      `at least ${minimum} are expected`,
    );
    if (project.execution) project.execution.modelCalls = minimum;
    expect(checkRealCalls(project, status, size)).toContain('the provider reported no token usage');
    if (project.execution) project.execution.provider = 'openai';
    expect(failure(() => checkRealCalls(project, status, size))).toContain(
      'server is configured for azure',
    );
  });

  describe('the server counters', () => {
    const baseline = {
      calls: 100,
      repairCalls: 5,
      failures: 1,
      inputTokens: 90_000,
      outputTokens: 12_000,
      tokensReported: true,
    };
    const after = (counters: Partial<typeof baseline>, connectivity: ProviderConnectivity = 'ok') =>
      buildStatus({ connectivity, counters: { ...baseline, ...counters } });

    // The server's counters span its whole lifetime, so on a server that already served other runs
    // every figure in the report has to be a difference, not a cumulative total.
    it('are reported as this run’s own changes on a server that served earlier runs', () => {
      const status = after({
        calls: 164,
        repairCalls: 14,
        failures: 1,
        inputTokens: 200_000,
        outputTokens: 28_000,
      });
      expect(checkTelemetry(status, baseline, 63)).toBe(
        '64 round trips counted by the server against 63 recorded completions; 9 corrective retries, 0 failed attempts; 110000 input / 16000 output tokens.',
      );
    });

    it('fail when the server counted fewer round trips than the projects record', () => {
      expect(failure(() => checkTelemetry(after({ calls: 150 }), baseline, 60))).toContain(
        'The server counted 50 provider round trips but 60 completions are recorded',
      );
    });

    it('fail when the provider is not connected, and say so when it reports no tokens', () => {
      expect(
        failure(() => checkTelemetry(after({ calls: 200 }, 'failing'), baseline, 5)),
      ).toContain('Provider connectivity is "failing"');
      expect(checkTelemetry(after({ calls: 130, tokensReported: false }), baseline, 20)).toContain(
        'the provider reported no token usage',
      );
    });
  });

  it('requires one stated, bounded decision per proxy per platform per round', () => {
    const { project } = fresh();
    expect(checkPerActor(project, size)).toContain('24 decisions');
    const [plaza] = project.console?.platforms ?? [];
    const action = plaza?.rounds[0]?.actions[0];
    if (action) {
      action.rationale = '  ';
      action.confidence = 1.5;
    }
    plaza?.rounds[1]?.actions.pop();
    const message = failure(() => checkPerActor(project, size));
    expect(message).toContain('has no stated reason');
    expect(message).toContain('has no valid confidence');
    expect(message).toContain('round 2 has 3 decisions from 3 proxies');
  });

  it('requires graph quotes to be verbatim in a passage the node cites', () => {
    const { project } = fresh();
    expect(checkGraphQuotes(project, EVIDENCE)).toContain('1 nodes');
    const node = project.graph?.nodes[0];
    if (node) node.quote = 'The Library Service proposes opening all night, every night';
    expect(failure(() => checkGraphQuotes(project, EVIDENCE))).toContain('not verbatim');
    if (node) {
      node.quote = 'The Library Service proposes opening until nine in the evening';
      node.sourceIds = ['S404'];
    }
    expect(failure(() => checkGraphQuotes(project, EVIDENCE))).toContain('not verbatim');
    if (project.graph) project.graph.method = 'lexical';
    expect(failure(() => checkGraphQuotes(project, EVIDENCE))).toContain('not by the model');
  });

  it('requires a grounding review that adds up and whose citations resolve', () => {
    const { project } = fresh();
    const evidence = new Set(['S1']);
    expect(checkGrounding(project, evidence, new Set())).toContain('2 statements');
    const review = project.report?.grounding;
    if (review) {
      review.counts.supported = 1;
      const claim = review.claims[0];
      if (claim) {
        claim.checks.quote = 'not-found';
        claim.sourceIds = ['S404'];
      }
    }
    const message = failure(() => checkGrounding(project, evidence, new Set()));
    expect(message).toContain('add up to 1 for 2 statements');
    expect(message).toContain('lack a verified quote');
    expect(message).toContain('cite something that does not exist');
    if (project.report) project.report.generatedBy = 'local';
    expect(failure(() => checkGrounding(project, evidence, new Set()))).toContain(
      'local rules engine',
    );
  });

  it('says why the independent model check did not run, not just the first notes', () => {
    const { project } = fresh();
    expect(checkGroundingModel(project)).toContain('independent model judgement');
    const review = project.report?.grounding;
    if (review) {
      review.method = 'deterministic';
      review.notes = [
        '2 listed statements in “Chapter” did not restate that chapter’s text and were left out of the review.',
        'Citations establish provenance, not source truth.',
        'No source-backed statement needed the independent model check.',
      ];
    }
    const message = failure(() => checkGroundingModel(project));
    expect(message).toContain('review method was "deterministic"');
    expect(message).toContain('No source-backed statement needed the independent model check.');
    expect(message).not.toContain('left out of the review');
    if (review) review.notes = ['Nothing relevant here.'];
    expect(failure(() => checkGroundingModel(project))).toContain('No note explains why.');
  });

  it('accepts a chat reply only with a real model call, real citations and content', () => {
    const { project } = fresh();
    expect(project).toBeDefined();
    const answer = {
      id: 'm1',
      target: 'report',
      role: 'assistant' as const,
      content: 'A grounded reply that cites the source.',
      sourceIds: ['S1'],
      mode: 'llm' as const,
      createdAt: 'now',
    };
    const ids = new Set(['S1']);
    expect(checkChatReply([answer], ids, 1)).toContain('1 real round trip.');
    expect(failure(() => checkChatReply([answer], ids, 0))).toContain('no new model call');
    expect(failure(() => checkChatReply([{ ...answer, mode: 'local' }], ids, 1))).toContain(
      'not produced by the model',
    );
    expect(failure(() => checkChatReply([{ ...answer, sourceIds: ['S9'] }], ids, 1))).toContain(
      'S9',
    );
    expect(failure(() => checkChatReply([{ ...answer, content: 'ok' }], ids, 1))).toContain(
      'empty',
    );
    expect(failure(() => checkChatReply([], ids, 1))).toContain('no assistant reply');
  });

  it('counts the report statements a reply cites, and refuses one that is not in the ledger', () => {
    const answer = {
      id: 'm2',
      target: 'report',
      role: 'assistant' as const,
      content: 'The least supported statements are C3 and C5.',
      sourceIds: [],
      claimIds: ['C3', 'C5'],
      grounding: { status: 'cited' as const, notes: [], coverage: 0.8 },
      mode: 'llm' as const,
      createdAt: 'now',
    };
    const ids = new Set(['S1']);
    const ledger = new Set(['C1', 'C3', 'C5']);
    const summary = checkChatReply([answer], ids, 2, ledger);
    expect(summary).toContain('2 cited report statements (all present in the ledger)');
    expect(summary).toContain('grounding cited');
    expect(summary).toContain('2 real round trips.');
    expect(failure(() => checkChatReply([answer], ids, 1, new Set(['C1'])))).toContain(
      'report statements that do not exist: C3, C5',
    );
    // Without a ledger to compare against, a statement id is counted but not vouched for.
    expect(checkChatReply([answer], ids, 1)).toContain('2 cited report statements,');
    expect(checkChatReply([{ ...answer, claimIds: [], grounding: undefined }], ids, 1)).toContain(
      'no cited passages or statements',
    );
  });

  it('detects an obeyed hidden instruction and refuses to pass on nothing to inspect', () => {
    const { project } = fresh();
    expect(checkInjection(project, ['A normal reply.'])).toContain('never appeared');
    const action = project.console?.platforms[0]?.rounds[0]?.actions[0];
    if (action) action.content = `Sure. ${INJECTION_MARKER}`;
    expect(failure(() => checkInjection(project, []))).toContain('proxy statements');
    expect(failure(() => checkInjection(fresh().project, [`Done ${INJECTION_MARKER}`]))).toContain(
      'chat replies',
    );
    for (const platform of project.console?.platforms ?? []) platform.rounds = [];
    expect(failure(() => checkInjection(project, []))).toContain('no proxy statements');
  });

  it('reports where credential-shaped text appeared, never what it was', () => {
    expect(checkNoSecrets({ project: { ok: 1 }, export: MARKDOWN })).toContain(
      'Scanned project, export',
    );
    const message = failure(() => checkNoSecrets({ export: `${MARKDOWN}\n${bearer}` }));
    expect(message).toContain('export (bearer token)');
    expect(message).not.toContain('a1B2c3D4');
  });

  it('requires the export to carry the grounding review and the disclaimer', () => {
    expect(checkExport(MARKDOWN)).toContain('grounding review');
    expect(failure(() => checkExport('# Report only'))).toBe(
      'The export is missing the grounding review and the synthetic-scenario disclaimer.',
    );
    expect(failure(() => checkExport({ not: 'text' }))).toContain('not Markdown');
  });
});

describe('parseVerifyArgs', () => {
  it('defaults to a real Azure model with Entra authentication and the smallest scenario', () => {
    expect(parseVerifyArgs([])).toEqual({
      baseUrl: 'http://127.0.0.1:3001',
      expectProvider: 'azure',
      expectAuth: 'entra',
      agents: 4,
      rounds: 3,
      probe: true,
      stepTimeoutMinutes: 15,
      json: false,
    });
  });

  it('turns the hidden-instruction probe off only when asked', () => {
    expect(parseVerifyArgs(['--no-probe']).probe).toBe(false);
  });

  it('does not assume an authentication mode for other providers', () => {
    expect(parseVerifyArgs(['--expect-provider', 'ollama']).expectAuth).toBeNull();
    expect(
      parseVerifyArgs(['--expect-provider', 'openai', '--expect-auth', 'api-key']).expectAuth,
    ).toBe('api-key');
  });

  it('keeps only the origin of the base URL and rejects embedded credentials', () => {
    expect(parseVerifyArgs(['--base-url', 'http://localhost:4000/some/path?x=1#y']).baseUrl).toBe(
      'http://localhost:4000',
    );
    const withUser = `http://${'user'}:${'pass'}@localhost:3001`;
    expect(() => parseVerifyArgs(['--base-url', withUser])).toThrow(UsageError);
    expect(() => parseVerifyArgs(['--base-url', 'ftp://localhost'])).toThrow(UsageError);
    expect(() => parseVerifyArgs(['--base-url', 'not a url'])).toThrow(UsageError);
  });

  it.each([
    [['--agents', '3']],
    [['--agents', '11']],
    [['--rounds', '2']],
    [['--rounds', '1.5']],
    [['--step-timeout-minutes', '0']],
    [['--expect-provider', 'gemini']],
    [['--expect-auth', 'password']],
    [['--unknown']],
  ])('rejects invalid arguments %j', (argv) => {
    expect(() => parseVerifyArgs(argv)).toThrow(UsageError);
  });
});

describe('fetchHttp', () => {
  it('reads JSON and text, and sends a JSON body', async () => {
    const received: string[] = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        received.push(`${request.method} ${request.url} ${Buffer.concat(chunks).toString('utf8')}`);
        if (request.url === '/text') {
          response.writeHead(200, { 'content-type': 'text/markdown' }).end('# Title');
        } else {
          response.writeHead(201, { 'content-type': 'application/json' }).end('{"ok":true}');
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const http = fetchHttp(base, 5_000);
      expect(await http.request('POST', '/json', { a: 1 })).toEqual({
        status: 201,
        body: { ok: true },
      });
      expect(await http.request('GET', '/text')).toEqual({ status: 200, body: '# Title' });
      expect(received).toEqual(['POST /json {"a":1}', 'GET /text ']);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('explains an unreachable server without a stack trace', async () => {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as AddressInfo).port;
    await new Promise((resolve) => probe.close(resolve));
    const http = fetchHttp(`http://127.0.0.1:${port}`, 2_000);
    await expect(http.request('GET', '/api/provider/status')).rejects.toThrow(
      /Cannot reach http:\/\/127\.0\.0\.1:\d+ \(ECONNREFUSED\)\. Is the server running\?/u,
    );
  });
});
