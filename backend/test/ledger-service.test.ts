import { afterEach, describe, expect, it } from 'vitest';
import type { ClaimRecord, ContradictionRecord } from '../../shared/evidence.js';
import type { GroundedClaim, GroundingReview } from '../../shared/grounding.js';
import { buildApp } from '../src/app.js';
import {
  buildClaimRecords,
  conflictTouchesStatement,
  reconcileClaim,
  type SourceConflict,
} from '../src/grounding/ledger.js';
import { LedgerService } from '../src/grounding/service.js';
import { createBranch } from '../src/guided/whatif.js';
import { fixtureInput, testConfig } from './fixtures.js';

export const COUNCIL =
  'Annual ferry ridership reached 412,000 passengers in 2024 according to the island council. ' +
  'The council supports the electric ferry plan for the island route this winter.';
export const OPERATOR =
  'Annual ferry ridership was 365,000 passengers in 2024 according to the ferry operator. ' +
  'The operator reports it will deliver the island route plan with the current diesel vessel.';

const applications: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

export async function setup() {
  const instance = await buildApp({ config: testConfig() });
  applications.push(instance);
  const project = instance.repository.create(
    fixtureInput({
      workflow: 'guided',
      documents: [
        { name: 'council-note.md', content: COUNCIL },
        { name: 'operator-memo.md', content: OPERATOR },
      ],
    }),
  );
  return { ...instance, project, ledger: new LedgerService(instance.repository) };
}

function grounded(overrides: Partial<GroundedClaim>): GroundedClaim {
  return {
    id: 'C1',
    section: 'Evidence',
    text: 'The council note reports 412,000 annual passengers.',
    kind: 'extracted-claim',
    sourceIds: ['S1'],
    memoryIds: [],
    quote: null,
    verdict: 'supported',
    checks: { quote: null, overlap: 0.9, numbers: 'match', entailment: null },
    reason: 'Matches the cited passage.',
    ...overrides,
  };
}

/** A grounding review the report writer could have produced for the two sources above. */
export function review(checkedAt = '2026-10-29T09:00:00.000Z'): GroundingReview {
  const claims = [
    grounded({}),
    grounded({
      id: 'C2',
      text: 'The council supports the electric ferry plan for the island route.',
    }),
    grounded({
      id: 'C3',
      text: 'The operator reports annual ridership of 365,000 passengers.',
      sourceIds: ['S2'],
      verdict: 'partial',
    }),
    grounded({
      id: 'C4',
      text: 'Residents may switch to the ferry if fares fall.',
      kind: 'ai-hypothesis',
      sourceIds: [],
      verdict: 'unchecked',
      checks: { quote: null, overlap: null, numbers: null, entailment: null },
    }),
  ];
  return {
    checkedAt,
    method: 'deterministic',
    claims,
    counts: { supported: 2, partial: 1, unsupported: 0, contradicted: 0, unchecked: 1 },
    unverifiedFigures: [],
    notes: [],
  };
}

export function withReport(
  harness: Awaited<ReturnType<typeof setup>>,
  grounding: GroundingReview = review(),
): void {
  harness.repository.update(harness.project.id, {
    report: {
      generatedBy: 'llm',
      title: 'Ferry report',
      executiveSummary: 'Summary.',
      sections: [
        { title: 'Evidence', body: 'Body text of the evidence chapter.', sourceIds: ['S1'] },
      ],
      limitations: [],
      grounding,
      metrics: {
        initialMean: 0,
        finalMean: 0,
        finalSupport: 0.5,
        finalOpposition: 0.3,
        polarization: 0.2,
        totalInteractions: 10,
      },
    },
  });
}

const ref = (passageId: string, quote: string) => ({
  passageId,
  documentId: passageId.replace('S', 'D'),
  documentName: `${passageId}.md`,
  start: 0,
  end: 100,
  quote,
  contentHash: 'a'.repeat(64),
  role: 'contradicts' as const,
});

const conflict: SourceConflict = {
  id: 'X1',
  topic: 'annual ferry passengers ridership',
  leftValue: '412,000',
  rightValue: '365,000',
  left: ref('S1', 'Annual ferry ridership reached 412,000 passengers'),
  right: ref('S2', 'Annual ferry ridership was 365,000 passengers'),
};

describe('conflictTouchesStatement', () => {
  it('touches a statement that repeats one of the conflicting figures', () => {
    expect(conflictTouchesStatement(conflict, 'The council says 412,000 people rode.')).toBe(true);
    expect(conflictTouchesStatement(conflict, 'The operator counted 365000 trips.')).toBe(true);
  });

  it('touches a statement that shares enough of the conflict’s topic', () => {
    expect(conflictTouchesStatement(conflict, 'Annual ferry ridership grew strongly.')).toBe(true);
  });

  it('does not touch a statement about something else', () => {
    expect(conflictTouchesStatement(conflict, 'The council supports the electric plan.')).toBe(
      false,
    );
    expect(conflictTouchesStatement(conflict, 'Fares might fall next year.')).toBe(false);
  });
});

describe('reconcileClaim', () => {
  const now = new Date('2026-10-30T00:00:00.000Z');
  const passages = new Map([
    [
      'S1',
      {
        id: 'S1',
        documentId: 'D1',
        documentName: 'D1.md',
        text: COUNCIL,
        start: 0,
        end: COUNCIL.length,
      },
    ],
  ]);
  const [mixed] = buildClaimRecords({
    projectId: 'p',
    parentId: null,
    branchFromRound: null,
    review: review(),
    passages,
    memories: new Map(),
    assumptions: [],
    conflicts: [conflict],
    now: new Date('2026-10-29T09:00:00.000Z'),
  }) as [ClaimRecord];

  it('restores the class when the conflict is no longer open, keeping history', () => {
    expect(mixed.supportClass).toBe('partially-supported');
    const resolved = reconcileClaim(mixed, [], now);
    expect(resolved.supportClass).toBe('directly-supported');
    expect(resolved.contradicting).toEqual([]);
    expect(resolved.publication.status).toBe('finding');
    expect(resolved.version).toBe(2);
    expect(resolved.history).toHaveLength(2);
    expect(resolved.history[1]).toMatchObject({ actor: 'system', version: 2 });
  });

  it('returns the very same record when nothing changed', () => {
    expect(reconcileClaim(mixed, [conflict], now)).toBe(mixed);
  });

  it('keeps evidence from the independent check when conflicts change', () => {
    const own = { ...ref('S1', 'a contradicting excerpt'), conflictId: undefined };
    const record: ClaimRecord = { ...mixed, contradicting: [own, ...mixed.contradicting] };
    const next = reconcileClaim(record, [], now);
    expect(next.contradicting).toEqual([own]);
  });
});

describe('the ledger for a project', () => {
  it('detects the disagreement between the sources even before any report exists', async () => {
    const { ledger, project } = await setup();
    const result = ledger.get(project.id);
    expect(result.claims).toEqual([]);
    expect(result.contradictions).toHaveLength(1);
    const [found] = result.contradictions as [ContradictionRecord];
    expect(found).toMatchObject({ id: 'X1', kind: 'numeric', status: 'detected' });
    expect([found.leftValue, found.rightValue].sort()).toEqual(['365,000', '412,000']);
    expect(result.sufficiency.level).toBe('insufficient');
    expect(result.reviewedAt).toBeNull();
  });

  it('builds one record per reviewed statement and weighs the conflict only where it applies', async () => {
    const harness = await setup();
    withReport(harness);
    const result = harness.ledger.get(harness.project.id);
    expect(result.claims.map((claim) => claim.id)).toEqual(['C1', 'C2', 'C3', 'C4']);
    const byId = Object.fromEntries(result.claims.map((claim) => [claim.id, claim]));
    // C1 repeats a conflicting figure, so it is no longer directly supported.
    expect(byId.C1?.supportClass).toBe('partially-supported');
    expect(byId.C1?.contradicting[0]?.passageId).toBe('S2');
    expect(byId.C1?.publication.status).toBe('contradiction-shown');
    // C2 cites the same passage but is about something the sources agree on.
    expect(byId.C2?.supportClass).toBe('directly-supported');
    expect(byId.C3?.supportClass).toBe('partially-supported');
    expect(byId.C4?.supportClass).toBe('not-checkable');
    expect(byId.C4?.publication.status).toBe('labelled-unverified');
    expect(result.reviewedAt).toBe('2026-10-29T09:00:00.000Z');
  });

  it('builds once and does not rebuild on every read', async () => {
    const harness = await setup();
    withReport(harness);
    harness.ledger.get(harness.project.id);
    harness.ledger.get(harness.project.id);
    harness.ledger.get(harness.project.id);
    const built = harness.repository.audit
      .list({ projectId: harness.project.id })
      .filter((event) => event.action === 'ledger.built');
    expect(built).toHaveLength(1);
  });

  it('rebuilds when the report was reviewed again, dropping the old statements', async () => {
    const harness = await setup();
    withReport(harness);
    harness.ledger.reviewClaim(harness.project.id, 'C2', { result: 'accepted', note: null });
    withReport(harness, {
      ...review('2026-10-30T09:00:00.000Z'),
      claims: review().claims.slice(0, 1),
    });
    const result = harness.ledger.get(harness.project.id);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]?.review.result).toBe('pending');
    // What happened to the old statement is still on the record.
    const actions = harness.repository.audit
      .list({ projectId: harness.project.id })
      .map((e) => e.action);
    expect(actions).toContain('claim.reviewed');
  });

  it('records the branch lineage on every statement of a branch', async () => {
    const harness = await setup();
    const { project, repository, jobs } = harness;
    jobs.enqueueStep(project.id, 'knowledge');
    await jobs.idle();
    jobs.enqueueStep(project.id, 'environment');
    await jobs.idle();
    jobs.enqueueStep(project.id, 'simulation');
    await jobs.idle();
    const branch = createBranch(repository, project.id, { fromRound: 1, agentEdits: [] });
    withReport({ ...harness, project: branch });
    const result = harness.ledger.get(branch.id);
    expect(result.claims.length).toBeGreaterThan(0);
    for (const claim of result.claims) {
      expect(claim.lineage).toMatchObject({
        projectId: branch.id,
        parentId: project.id,
        branchFromRound: 1,
      });
    }
  });
});

describe('reviewing statements', () => {
  it('records the review, versions the statement and audits it without storing the note', async () => {
    const harness = await setup();
    withReport(harness);
    const note = 'Confirmed with the operator on Tuesday.';
    const reviewed = harness.ledger.reviewClaim(harness.project.id, 'C2', {
      result: 'accepted',
      note,
    });
    expect(reviewed.version).toBe(2);
    expect(reviewed.review).toMatchObject({ result: 'accepted', note });
    expect(harness.ledger.claim(harness.project.id, 'C2').version).toBe(2);
    const event = harness.repository.audit
      .list({ projectId: harness.project.id })
      .find((candidate) => candidate.action === 'claim.reviewed');
    expect(event).toMatchObject({ actor: 'local-user', targetId: 'C2' });
    expect(event?.detail).toMatchObject({ result: 'accepted', version: 2, noteChars: note.length });
    expect(JSON.stringify(event)).not.toContain('Tuesday');
    expect(harness.repository.audit.verify().ok).toBe(true);
  });

  it('refuses a review of a version someone else already changed', async () => {
    const harness = await setup();
    withReport(harness);
    harness.ledger.reviewClaim(harness.project.id, 'C2', { result: 'accepted', note: null });
    expect(() =>
      harness.ledger.reviewClaim(harness.project.id, 'C2', { result: 'rejected', note: null }, 1),
    ).toThrow(/Someone else changed/u);
    expect(harness.ledger.claim(harness.project.id, 'C2').review.result).toBe('accepted');
  });

  it('refuses a stale write at the storage layer too, so a race can never overwrite silently', async () => {
    const harness = await setup();
    withReport(harness);
    const current = harness.ledger.claim(harness.project.id, 'C2');
    const first = { ...current, version: 2 };
    harness.repository.ledger.saveClaim(harness.project.id, first, 1);
    expect(() =>
      harness.repository.ledger.saveClaim(harness.project.id, { ...current, version: 2 }, 1),
    ).toThrow(/Someone else changed/u);
  });

  it('withholds a rejected statement and cannot upgrade an unsupported one by accepting it', async () => {
    const harness = await setup();
    withReport(harness);
    expect(
      harness.ledger.reviewClaim(harness.project.id, 'C2', { result: 'rejected', note: null })
        .publication.status,
    ).toBe('withheld');
    const hypothesis = harness.ledger.reviewClaim(harness.project.id, 'C4', {
      result: 'accepted',
      note: null,
    });
    expect(hypothesis.supportClass).toBe('not-checkable');
    expect(hypothesis.publication.status).toBe('labelled-unverified');
  });

  it('recalculates the statements a conflict touches when it is dismissed, and keeps their reviews', async () => {
    const harness = await setup();
    withReport(harness);
    harness.ledger.reviewClaim(harness.project.id, 'C1', { result: 'accepted', note: 'Seen.' });
    const { conflict: changed, ledger } = harness.ledger.reviewContradiction(
      harness.project.id,
      'X1',
      {
        status: 'dismissed',
        note: 'The operator figure counts a different route.',
      },
    );
    expect(changed.status).toBe('dismissed');
    const c1 = ledger.claims.find((claim) => claim.id === 'C1');
    expect(c1?.supportClass).toBe('directly-supported');
    expect(c1?.review.result).toBe('accepted');
    expect(c1?.history.map((entry) => entry.actor)).toEqual(['system', 'reviewer', 'system']);
    const c2 = ledger.claims.find((claim) => claim.id === 'C2');
    expect(c2?.version).toBe(1);
    // Confirming it again brings the weight back.
    const again = harness.ledger.reviewContradiction(harness.project.id, 'X1', {
      status: 'confirmed',
      note: null,
    });
    expect(again.ledger.claims.find((claim) => claim.id === 'C1')?.supportClass).toBe(
      'partially-supported',
    );
    expect(harness.repository.audit.verify().ok).toBe(true);
  });

  it('refuses an unknown statement or conflict', async () => {
    const harness = await setup();
    withReport(harness);
    expect(() => harness.ledger.claim(harness.project.id, 'C99')).toThrow(/does not exist/u);
    expect(() =>
      harness.ledger.reviewContradiction(harness.project.id, 'X99', {
        status: 'dismissed',
        note: null,
      }),
    ).toThrow(/does not exist/u);
  });
});

describe('the ledger API', () => {
  const api = (harness: Awaited<ReturnType<typeof setup>>) => `/api/projects/${harness.project.id}`;

  it('serves the ledger, with conflicts between sources and the sufficiency of the evidence', async () => {
    const harness = await setup();
    withReport(harness);
    const response = await harness.app.inject({ method: 'GET', url: `${api(harness)}/ledger` });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(body.claims).toHaveLength(4);
    expect(body.contradictions).toHaveLength(1);
    expect(body.sufficiency.level).toBe('insufficient');
    // The inputs that shape every simulated result are listed, and the export carries them too.
    expect(body.assumptions.map((a: { id: string }) => a.id)).toEqual(['A1']);
    expect(body.assumptions[0].statement).toContain('none of these is a measured value');
    expect(body.assumptions[0].scope).toBe('scenario');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('serves one statement with the whole passages, the conflicting quotation and the assumptions', async () => {
    const harness = await setup();
    withReport(harness);
    const response = await harness.app.inject({ method: 'GET', url: `${api(harness)}/claims/C1` });
    expect(response.statusCode, response.body).toBe(200);
    const detail = response.json();
    expect(detail.claim.id).toBe('C1');
    expect(detail.passages.map((passage: { id: string }) => passage.id).sort()).toEqual([
      'S1',
      'S2',
    ]);
    const quoted = detail.claim.contradicting[0];
    const source = detail.passages.find(
      (passage: { id: string }) => passage.id === quoted.passageId,
    );
    expect(source.text).toContain(quoted.quote);
  });

  it('records a review and shows it on the statement', async () => {
    const harness = await setup();
    withReport(harness);
    const response = await harness.app.inject({
      method: 'POST',
      url: `${api(harness)}/claims/C2/review`,
      payload: { result: 'accepted', note: 'Checked.', expectedVersion: 1 },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().claim).toMatchObject({ version: 2, review: { result: 'accepted' } });
    const stale = await harness.app.inject({
      method: 'POST',
      url: `${api(harness)}/claims/C2/review`,
      payload: { result: 'rejected', expectedVersion: 1 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('CLAIM_CONFLICT');
  });

  it('rejects malformed input before it reaches the ledger', async () => {
    const harness = await setup();
    withReport(harness);
    const post = (url: string, payload: unknown) =>
      harness.app.inject({ method: 'POST', url, payload: payload as object });
    expect((await post(`${api(harness)}/claims/C1/review`, { result: 'pending' })).statusCode).toBe(
      400,
    );
    expect(
      (
        await post(`${api(harness)}/claims/C1/review`, {
          result: 'accepted',
          note: 'x'.repeat(2_000),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await post(`${api(harness)}/claims/C1/review`, { result: 'accepted', expectedVersion: 0 }))
        .statusCode,
    ).toBe(400);
    expect(
      (await post(`${api(harness)}/claims/not-an-id/review`, { result: 'accepted' })).statusCode,
    ).toBe(400);
    expect(
      (await post(`${api(harness)}/conflicts/X1/review`, { status: 'detected' })).statusCode,
    ).toBe(400);
    expect(
      (await post(`${api(harness)}/claims/C99/review`, { result: 'accepted' })).statusCode,
    ).toBe(404);
    expect(
      (await harness.app.inject({ method: 'GET', url: '/api/projects/not-a-uuid/ledger' }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await harness.app.inject({
          method: 'GET',
          url: '/api/projects/00000000-0000-4000-8000-000000000000/ledger',
        })
      ).statusCode,
    ).toBe(404);
  });

  it('changes a conflict and recalculates the statements it touches', async () => {
    const harness = await setup();
    withReport(harness);
    const response = await harness.app.inject({
      method: 'POST',
      url: `${api(harness)}/conflicts/X1/review`,
      payload: { status: 'dismissed', note: 'Different routes.' },
    });
    expect(response.statusCode, response.body).toBe(200);
    const { conflict, ledger } = response.json();
    expect(conflict.status).toBe('dismissed');
    expect(ledger.claims.find((claim: { id: string }) => claim.id === 'C1').supportClass).toBe(
      'directly-supported',
    );
  });

  it('lists the audit trail of a project and verifies the chain', async () => {
    const harness = await setup();
    withReport(harness);
    await harness.app.inject({
      method: 'POST',
      url: `${api(harness)}/claims/C2/review`,
      payload: { result: 'accepted' },
    });
    const audit = await harness.app.inject({ method: 'GET', url: `${api(harness)}/audit` });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().events.map((event: { action: string }) => event.action)).toEqual(
      expect.arrayContaining(['ledger.built', 'claim.reviewed']),
    );
    const verified = await harness.app.inject({ method: 'GET', url: '/api/audit/verify' });
    expect(verified.json()).toMatchObject({ ok: true });
  });
});

describe('export', () => {
  const api = (harness: Awaited<ReturnType<typeof setup>>) => `/api/projects/${harness.project.id}`;
  it('carries the ledger in JSON, and nothing for a project with no report yet', async () => {
    const harness = await setup();
    const before = await harness.app.inject({
      method: 'GET',
      url: `${api(harness)}/export?format=json`,
    });
    expect(before.statusCode).toBe(200);
    expect(before.json().ledger).toBeNull();

    withReport(harness);
    const after = await harness.app.inject({
      method: 'GET',
      url: `${api(harness)}/export?format=json`,
    });
    const { ledger } = after.json();
    expect(ledger.claims).toHaveLength(4);
    expect(ledger.contradictions).toHaveLength(1);
    expect(ledger.sufficiency.level).toBe('insufficient');
    expect(ledger.assumptions).toHaveLength(1);
    expect(ledger.claims[0].publication.status).toBeTruthy();
  });

  it('puts a readable evidence ledger in Markdown, with how each statement must be shown', async () => {
    const harness = await setup();
    withReport(harness);
    harness.repository.update(harness.project.id, { status: 'completed' });
    const response = await harness.app.inject({
      method: 'GET',
      url: `${api(harness)}/export?format=markdown`,
    });
    expect(response.statusCode, response.body).toBe(200);
    const markdown = response.body;
    expect(markdown).toContain('## Evidence ledger');
    expect(markdown).toContain('The chapters above were written by a model');
    expect(markdown).toContain('Evidence sufficiency: **insufficient**');
    expect(markdown).toContain('### Conflicts between sources (1 open of 1)');
    expect(markdown).toContain('Directly supported');
    expect(markdown).toContain('Must be shown with');
    expect(markdown).toContain('Supported by');
    expect(markdown.indexOf('## Evidence ledger')).toBeLessThan(markdown.indexOf('## Limitations'));
  });

  it('escapes statement text in the Markdown ledger', async () => {
    const harness = await setup();
    const hostile = review();
    hostile.claims[0]!.text = '<script>alert(1)</script> [click](javascript:alert(2))';
    withReport(harness, hostile);
    harness.repository.update(harness.project.id, { status: 'completed' });
    const response = await harness.app.inject({
      method: 'GET',
      url: `${api(harness)}/export?format=markdown`,
    });
    expect(response.body).not.toContain('<script>');
    expect(response.body).not.toContain('[click](javascript:');
    expect(response.body).toContain('&lt;script&gt;');
  });
});
