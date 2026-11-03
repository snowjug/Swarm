import { readFileSync } from 'node:fs';
import { metrics } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { GATE_STATUSES as CONSTRAINT_GATE_STATUSES } from '../../shared/constraints.js';
import {
  FETCH_ERROR_CLASSES,
  QUARANTINE_REASONS,
  RESEARCH_MODES,
  RESEARCH_STOP_REASONS,
  SOURCE_CATEGORIES,
} from '../../shared/research.js';
import { classifyAddress } from '../src/ingest/url/policy.js';
import { RULE_CATALOGUE } from '../src/stakeholders/participants/validate.js';
import { ALLOWED_ATTRIBUTES, safeAttributes } from '../src/telemetry/attributes.js';
import {
  CANCEL_SCOPES,
  GATE_STATUSES,
  PARTICIPANT_ISSUE_CODES,
  PROPOSAL_ORIGINS,
  RESEARCH_OUTCOMES,
  SAFETY_BLOCK_REASONS,
  WORK_OUTCOMES,
  observeDeployment,
  productSignals,
  safetyReasonOfAddress,
} from '../src/telemetry/product-signals.js';
import { telemetryHarness } from './support/telemetry-harness.js';

const telemetry = telemetryHarness();

interface Signal {
  name: string;
  record: () => void;
  metric: string;
  attributes: Record<string, unknown>;
  /** What it adds: a count, or for a histogram the number of records. */
  by: number;
}

const SIGNALS: Signal[] = [
  {
    name: 'a research run starting',
    record: () => productSignals.researchRun({ outcome: 'started', mode: 'url' }),
    metric: 'swarm.research.runs',
    attributes: { 'swarm.research.outcome': 'started', 'swarm.research.mode': 'url' },
    by: 1,
  },
  ...(['completed', 'cancelled', 'failed', 'blocked'] as const).map((outcome): Signal => ({
    name: `a research run that ${outcome}`,
    record: () =>
      productSignals.researchRun({ outcome, mode: 'discovery', stopReason: 'evidence-sufficient' }),
    metric: 'swarm.research.runs',
    attributes: {
      'swarm.research.outcome': outcome,
      'swarm.research.mode': 'discovery',
      'swarm.research.stop_reason': 'evidence-sufficient',
    },
    by: 1,
  })),
  ...RESEARCH_STOP_REASONS.map((stopReason): Signal => ({
    name: `a research run that stopped for ${stopReason}`,
    record: () => productSignals.researchRun({ outcome: 'completed', mode: 'domain', stopReason }),
    metric: 'swarm.research.runs',
    attributes: { 'swarm.research.stop_reason': stopReason, 'swarm.research.mode': 'domain' },
    by: 1,
  })),
  {
    name: 'pages fetched',
    record: () => productSignals.researchPages({ count: 7, mode: 'domain' }),
    metric: 'swarm.research.pages',
    attributes: { 'swarm.research.mode': 'domain' },
    by: 7,
  },
  {
    name: 'a crawl duration',
    record: () =>
      productSignals.crawlDuration({ durationMs: 4_200, mode: 'url', stopReason: 'time-limit' }),
    metric: 'swarm.research.crawl.duration',
    attributes: { 'swarm.research.mode': 'url', 'swarm.research.stop_reason': 'time-limit' },
    by: 1,
  },
  ...FETCH_ERROR_CLASSES.map((errorClass): Signal => ({
    name: `a fetch that failed as ${errorClass}`,
    record: () => productSignals.fetchFailure(errorClass, 3),
    metric: 'swarm.research.fetch.failures',
    attributes: { 'swarm.fetch.error_class': errorClass },
    by: 3,
  })),
  ...SAFETY_BLOCK_REASONS.map((reason): Signal => ({
    name: `a request blocked as ${reason}`,
    record: () => productSignals.safetyBlock(reason),
    metric: 'swarm.research.safety.blocks',
    attributes: { 'swarm.safety.reason': reason },
    by: 1,
  })),
  ...QUARANTINE_REASONS.map((reason): Signal => ({
    name: `a page quarantined as ${reason}`,
    record: () => productSignals.quarantine(reason, 2),
    metric: 'swarm.research.quarantines',
    attributes: { 'swarm.quarantine.reason': reason },
    by: 2,
  })),
  ...SOURCE_CATEGORIES.map((category): Signal => ({
    name: `sources used as ${category}`,
    record: () => productSignals.sourcesUsed(category, 4),
    metric: 'swarm.research.sources.used',
    attributes: { 'swarm.source.category': category },
    by: 4,
  })),
  {
    name: 'evidence passages',
    record: () => productSignals.evidencePassages(31, 'url'),
    metric: 'swarm.research.evidence.passages',
    attributes: { 'swarm.research.mode': 'url' },
    by: 31,
  },
  {
    name: 'an actor proposal',
    record: () => productSignals.actorProposal({ origin: 'model', proposed: 8, valid: 6 }),
    metric: 'swarm.actors.proposals',
    attributes: { 'swarm.proposal.origin': 'model' },
    by: 1,
  },
  {
    name: 'the actors proposed',
    record: () => productSignals.actorProposal({ origin: 'rules', proposed: 8, valid: 6 }),
    metric: 'swarm.actors.proposed',
    attributes: { 'swarm.proposal.origin': 'rules' },
    by: 8,
  },
  {
    name: 'the actors that were valid',
    record: () => productSignals.actorProposal({ origin: 'fallback', proposed: 8, valid: 6 }),
    metric: 'swarm.actors.valid',
    attributes: { 'swarm.proposal.origin': 'fallback' },
    by: 6,
  },
  ...PARTICIPANT_ISSUE_CODES.map((code): Signal => ({
    name: `a participants issue of the rule ${code}`,
    record: () =>
      productSignals.actorProposal({
        origin: 'model',
        proposed: 5,
        valid: 3,
        issues: { [code]: 2 },
      }),
    metric: 'swarm.actors.issues',
    attributes: { 'swarm.issue.code': code },
    by: 2,
  })),
  {
    name: 'a constraint proposal',
    record: () => productSignals.constraintProposal({ origin: 'fallback', count: 5 }),
    metric: 'swarm.constraints.proposals',
    attributes: { 'swarm.proposal.origin': 'fallback' },
    by: 1,
  },
  {
    name: 'the constraints proposed',
    record: () => productSignals.constraintProposal({ origin: 'model', count: 5 }),
    metric: 'swarm.constraints.proposed',
    attributes: { 'swarm.proposal.origin': 'model' },
    by: 5,
  },
  ...GATE_STATUSES.map((status): Signal => ({
    name: `the constraint gate standing ${status}`,
    record: () => productSignals.constraintGate(status),
    metric: 'swarm.constraints.gate',
    attributes: { 'swarm.gate.status': status },
    by: 1,
  })),
  ...WORK_OUTCOMES.flatMap((outcome): Signal[] => [
    {
      name: `a simulation that ${outcome}`,
      record: () => productSignals.simulationDuration({ durationMs: 900, outcome }),
      metric: 'swarm.sim.duration',
      attributes: { 'swarm.sim.outcome': outcome },
      by: 1,
    },
    {
      name: `a report that ${outcome}`,
      record: () => productSignals.reportDuration({ durationMs: 1_500, outcome }),
      metric: 'swarm.report.duration',
      attributes: { 'swarm.report.outcome': outcome },
      by: 1,
    },
  ]),
  ...CANCEL_SCOPES.map((scope): Signal => ({
    name: `a ${scope} that a person cancelled`,
    record: () => productSignals.cancellation(scope),
    metric: 'swarm.cancellations',
    attributes: { 'swarm.cancel.scope': scope },
    by: 1,
  })),
];

describe('what the product tells its operators', () => {
  it.each(SIGNALS)('records $name as $metric', async ({ record, metric, attributes, by }) => {
    const before = telemetry.total(await telemetry.measurements(), metric, attributes);
    record();
    const after = telemetry.total(await telemetry.measurements(), metric, attributes);
    expect(after - before).toBe(by);
  });

  it('counts a proposal with no more valid actors than were proposed, and the issues by code', async () => {
    const issues = { 'generic-name': 4, 'a free text issue': 3, lower_case_code: 2 };
    const before = await telemetry.measurements();
    productSignals.actorProposal({ origin: 'fallback', proposed: 6, valid: 99, issues });
    const after = await telemetry.measurements();
    const by = (name: string, attributes: Record<string, unknown>) =>
      telemetry.total(after, name, attributes) - telemetry.total(before, name, attributes);
    expect(by('swarm.actors.proposed', { 'swarm.proposal.origin': 'fallback' })).toBe(6);
    expect(by('swarm.actors.valid', { 'swarm.proposal.origin': 'fallback' })).toBe(6);
    expect(by('swarm.actors.issues', { 'swarm.issue.code': 'generic-name' })).toBe(4);
    // Whatever is not a code of the review is counted together, and is never a name of its own.
    expect(by('swarm.actors.issues', { 'swarm.issue.code': 'other' })).toBe(5);
  });

  it('records every rule of the participants’ review as itself, reads a bounded number of entries, and folds the rest into other', async () => {
    const real = Object.fromEntries(PARTICIPANT_ISSUE_CODES.map((code) => [code, 1]));
    const junk = Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`junk-${index}`, 1]));
    const before = await telemetry.measurements();
    productSignals.actorProposal({
      origin: 'model',
      proposed: 1,
      valid: 1,
      issues: { ...real, ...junk },
    });
    const after = await telemetry.measurements();
    const by = (code: string) =>
      telemetry.total(after, 'swarm.actors.issues', { 'swarm.issue.code': code }) -
      telemetry.total(before, 'swarm.actors.issues', { 'swarm.issue.code': code });
    for (const code of PARTICIPANT_ISSUE_CODES) expect(by(code), code).toBe(1);
    // Forty entries are read, and the real ones came first: the other seventeen are junk, counted as one.
    expect(by('other')).toBe(40 - PARTICIPANT_ISSUE_CODES.length);
    expect(
      (await telemetry.measurements()).some((point) =>
        String(point.attributes['swarm.issue.code']).startsWith('junk-'),
      ),
    ).toBe(false);
  });

  it('keeps the lists it names in step with the code that owns them', () => {
    expect([...GATE_STATUSES]).toEqual([...CONSTRAINT_GATE_STATUSES]);
    expect([...PARTICIPANT_ISSUE_CODES].sort()).toEqual(Object.keys(RULE_CATALOGUE).sort());
  });

  it('ignores a count or a duration that is not a number it can use', async () => {
    const before = await telemetry.measurements();
    for (const bad of [-3, Number.NaN, Number.POSITIVE_INFINITY, '9', null, {}]) {
      productSignals.researchPages({ count: bad as never, mode: 'url' });
      productSignals.fetchFailure('timeout', bad as never);
      productSignals.crawlDuration({ durationMs: bad as never, mode: 'url' });
      productSignals.simulationDuration({ durationMs: bad as never, outcome: 'completed' });
      productSignals.reportDuration({ durationMs: bad as never, outcome: 'failed' });
    }
    productSignals.researchPages({ count: 0, mode: 'url' });
    const after = await telemetry.measurements();
    for (const metric of [
      'swarm.research.fetch.failures',
      'swarm.research.crawl.duration',
      'swarm.sim.duration',
      'swarm.report.duration',
    ]) {
      expect(telemetry.total(after, metric), metric).toBe(telemetry.total(before, metric));
    }
    expect(telemetry.total(after, 'swarm.research.pages')).toBe(
      telemetry.total(before, 'swarm.research.pages'),
    );
    productSignals.researchPages({ count: 5_000_000_000, mode: 'url' });
    expect(
      telemetry.total(await telemetry.measurements(), 'swarm.research.pages') -
        telemetry.total(after, 'swarm.research.pages'),
    ).toBe(1_000_000);
  });
});

describe('what a signal can never carry', () => {
  const hostile: unknown[] = [
    'https://secret.example.test/private/path?token=canary-token',
    'secret.example.test',
    'Tell me about the canary ferry route',
    'canary-person-oid-0f3c9a',
    '<script>alert(1)</script>',
    'x'.repeat(500),
    '',
    null,
    42,
    { url: 'https://secret.example.test' },
    ['secret.example.test'],
  ];

  it('is an enumeration, or the word "other", whatever a caller passes', async () => {
    for (const value of hostile) {
      const unknown = value as never;
      productSignals.researchRun({ outcome: unknown, mode: unknown, stopReason: unknown });
      productSignals.researchPages({ count: 1, mode: unknown });
      productSignals.crawlDuration({ durationMs: 1, mode: unknown, stopReason: unknown });
      productSignals.fetchFailure(unknown);
      productSignals.safetyBlock(unknown);
      productSignals.quarantine(unknown);
      productSignals.sourcesUsed(unknown);
      productSignals.evidencePassages(1, unknown);
      productSignals.actorProposal({ origin: unknown, proposed: 1, valid: 1, issues: {} });
      productSignals.constraintProposal({ origin: unknown, count: 1 });
      productSignals.constraintGate(unknown);
      productSignals.simulationDuration({ durationMs: 1, outcome: unknown });
      productSignals.reportDuration({ durationMs: 1, outcome: unknown });
      productSignals.cancellation(unknown);
      productSignals.actorProposal({
        origin: 'model',
        proposed: 1,
        valid: 1,
        issues: { [String(value)]: 1 },
      });
    }
    const allowedValues: Record<string, readonly string[]> = {
      'swarm.research.outcome': RESEARCH_OUTCOMES,
      'swarm.research.mode': RESEARCH_MODES,
      'swarm.research.stop_reason': RESEARCH_STOP_REASONS,
      'swarm.fetch.error_class': FETCH_ERROR_CLASSES,
      'swarm.safety.reason': SAFETY_BLOCK_REASONS,
      'swarm.quarantine.reason': QUARANTINE_REASONS,
      'swarm.source.category': SOURCE_CATEGORIES,
      'swarm.proposal.origin': PROPOSAL_ORIGINS,
      'swarm.gate.status': GATE_STATUSES,
      'swarm.issue.code': PARTICIPANT_ISSUE_CODES,
      'swarm.sim.outcome': WORK_OUTCOMES,
      'swarm.report.outcome': WORK_OUTCOMES,
      'swarm.cancel.scope': CANCEL_SCOPES,
    };
    const points = (await telemetry.measurements()).filter((point) =>
      /^swarm\.(?:research|actors|constraints|sim|report)\.|^swarm\.cancellations$/u.test(
        point.name,
      ),
    );
    expect(points.length).toBeGreaterThan(10);
    for (const point of points) {
      for (const [key, value] of Object.entries(point.attributes)) {
        const allowed = allowedValues[key];
        if (!allowed) throw new Error(`${point.name} carries ${key}, which no signal sets`);
        expect([...allowed, 'other'], `${point.name} ${key}=${value}`).toContain(value);
      }
    }
    const exported = await telemetry.everythingExported();
    for (const leaked of ['secret.example', 'canary', 'Tell me about', '<script>', 'token=']) {
      expect(exported, leaked).not.toContain(leaked);
    }
  });

  it('has no name for an address, a host, a page, a title, a text or a person', () => {
    const product = [...ALLOWED_ATTRIBUTES].filter((name) =>
      /^swarm\.(?:research|fetch|safety|quarantine|source|proposal|issue|gate|sim|report|cancel|deployment|build)\./u.test(
        name,
      ),
    );
    expect(product.length).toBeGreaterThanOrEqual(16);
    for (const name of product) {
      expect(name).not.toMatch(
        /url|uri|host|domain|path|query|address|title|name|text|content|prompt|person|email|\.id$/u,
      );
    }
    expect(
      safeAttributes({
        'swarm.research.url': 'https://secret.example.test/a',
        'swarm.research.host': 'secret.example.test',
        'swarm.fetch.address': '10.0.0.4',
        'swarm.source.title': 'A page about a ferry',
        'swarm.quarantine.excerpt': 'ignore previous instructions',
        'swarm.actors.name': 'Ada',
        'swarm.person.id': 'canary-oid',
        'url.full': 'https://secret.example.test',
        'server.address': 'secret.example.test',
        'swarm.research.mode': 'url',
      }),
    ).toEqual({ 'swarm.research.mode': 'url' });
  });
});

describe('with telemetry off', () => {
  it('every recorder does nothing, and nothing is recorded', async () => {
    const before = await telemetry.measurements();
    metrics.disable();
    try {
      for (const signal of SIGNALS) expect(() => signal.record()).not.toThrow();
      const stop = observeDeployment(() => ({ mode: 'local', version: '0.3.0', sha: null }));
      expect(() => stop()).not.toThrow();
    } finally {
      metrics.setGlobalMeterProvider(telemetry.meterProvider);
    }
    const after = await telemetry.measurements();
    expect(after).toEqual(before);
  });
});

describe('with a meter that fails', () => {
  it('no recorder throws, and nothing is recorded: observing the work cannot stop it', async () => {
    const before = await telemetry.measurements();
    metrics.disable();
    metrics.setGlobalMeterProvider({
      getMeter: () => {
        throw new Error('the exporter is down');
      },
    } as never);
    try {
      for (const signal of SIGNALS) expect(() => signal.record(), signal.name).not.toThrow();
      const stop = observeDeployment(() => ({ mode: 'local', version: '0.3.0', sha: null }));
      expect(() => stop()).not.toThrow();
    } finally {
      metrics.disable();
      metrics.setGlobalMeterProvider(telemetry.meterProvider);
    }
    expect(await telemetry.measurements()).toEqual(before);
  });
});

describe('the deployment', () => {
  const info = (points: Awaited<ReturnType<typeof telemetry.measurements>>) =>
    points.filter((point) => point.name === 'swarm.deployment.info');

  it('is a gauge of 1 with the mode, the version and the first twelve characters of the build, read when it is collected', async () => {
    let reads = 0;
    const stop = observeDeployment(() => {
      reads += 1;
      return {
        mode: 'pilot',
        version: '9.9.9-gauge',
        sha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
      };
    });
    expect(info(await telemetry.measurements())).toContainEqual({
      name: 'swarm.deployment.info',
      attributes: {
        'swarm.deployment.mode': 'pilot',
        'swarm.build.version': '9.9.9-gauge',
        'swarm.build.sha': 'a1b2c3d4e5f6',
      },
      value: 1,
    });
    expect(reads).toBeGreaterThan(0);
    stop();
    const stopped = reads;
    await telemetry.measurements();
    expect(reads).toBe(stopped);
  });

  it('records nothing that is not a mode, a version or a commit', async () => {
    const stop = observeDeployment(() => ({
      mode: 'Canary Mode With Spaces' as never,
      version: 'a version with spaces and a canary-token',
      sha: 'not-a-commit-canary',
    }));
    try {
      expect(info(await telemetry.measurements())).toContainEqual(
        expect.objectContaining({
          attributes: {
            'swarm.deployment.mode': 'other',
            'swarm.build.version': 'other',
            'swarm.build.sha': 'unknown',
          },
        }),
      );
      expect(await telemetry.everythingExported()).not.toContain('canary');
    } finally {
      stop();
    }
  });
});

describe('the address classifier', () => {
  it('has a safety reason for every verdict it can give', () => {
    const reasons = new Set<string>();
    for (const address of [
      '0.0.0.0',
      '10.0.0.1',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '192.0.0.1',
      '192.0.2.1',
      '192.88.99.1',
      '192.168.1.1',
      '198.18.0.1',
      '198.51.100.1',
      '203.0.113.1',
      '224.0.0.1',
      '255.255.255.255',
      '240.0.0.1',
      '::',
      '::1',
      '::2',
      'fc00::1',
      'fe80::1',
      'fec0::1',
      'ff00::1',
      '2001::1',
      '2001:db8::1',
      '3fff::1',
      'not an address',
    ]) {
      const verdict = classifyAddress(address);
      if (!verdict.allowed) reasons.add(verdict.reason);
    }
    expect(reasons.size).toBeGreaterThan(10);
    for (const reason of reasons) {
      expect(SAFETY_BLOCK_REASONS, reason).toContain(safetyReasonOfAddress(reason));
    }
    expect(safetyReasonOfAddress('loopback')).toBe('loopback-address');
    expect(safetyReasonOfAddress('private-network')).toBe('private-address');
    expect(safetyReasonOfAddress('something-new')).toBe('reserved-address');
  });
});

describe('the catalogue', () => {
  it('is written down: every metric a signal creates is in docs/production/privacy-telemetry.md', async () => {
    for (const signal of SIGNALS) signal.record();
    const names = new Set(
      (await telemetry.measurements())
        .map((point) => point.name)
        .filter(
          (name) =>
            /^swarm\.(?:research|actors|constraints|sim|report)\./u.test(name) ||
            name === 'swarm.cancellations' ||
            name === 'swarm.deployment.info',
        ),
    );
    expect(names.size).toBeGreaterThanOrEqual(19);
    const guide = readFileSync(
      new URL('../../docs/production/privacy-telemetry.md', import.meta.url),
      'utf8',
    );
    for (const name of names) expect(guide, name).toContain(`\`${name}\``);
  });
});
