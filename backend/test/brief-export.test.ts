import { describe, expect, it } from 'vitest';
import { decisionBriefSchema } from '../../shared/brief.js';
import { buildBrief } from '../src/brief/build.js';
import {
  BRIEF_CSP,
  briefHtml,
  briefJson,
  briefMarkdown,
  type BriefExportInput,
} from '../src/brief/export.js';
import { gatherFacts } from '../src/brief/facts.js';
import { briefVisuals } from '../src/brief/visuals.js';
import { MEMO_CSP } from '../src/studio/export.js';
import { stakeholderSchema } from '../../shared/stakeholders.js';
import {
  passage,
  richAnalysis,
  richInputs,
  richStakeholders,
  TIME,
} from './support/brief-world.js';

const HOSTILE = `<script>alert('x')</script> & "><img src=x onerror=alert(1)> [click](javascript:alert(2)) | cell | \`code\` * _bold_ # heading`;

/** The same brief as the routes make, but with hostile text in every place a person or a source can put some. */
function hostileExport(): BriefExportInput {
  const stakeholders = richStakeholders();
  stakeholders.stakeholders[1] = stakeholderSchema.parse({
    ...stakeholders.stakeholders[1],
    name: `Group ${HOSTILE}`.slice(0, 120),
    relevance: HOSTILE,
    evidence: [
      passage({ quote: HOSTILE.slice(0, 500), documentName: `Doc ${HOSTILE}`.slice(0, 200) }),
    ],
  });
  const analysis = richAnalysis();
  analysis.actors = analysis.actors.map((actor) =>
    actor.id === 'subscribers' ? { ...actor, name: `Group ${HOSTILE}`.slice(0, 120) } : actor,
  );
  analysis.findings = analysis.findings.map((finding) =>
    finding.id === 'f2' ? { ...finding, statement: HOSTILE } : finding,
  );
  const inputs = richInputs({
    stakeholders,
    analysis,
    project: { id: 'p1', name: `Project ${HOSTILE}`.slice(0, 100), question: HOSTILE },
    scenario: { ...richInputs().scenario!, decision: HOSTILE, baseline: HOSTILE },
    documents: [{ id: 'doc-1', name: `Doc ${HOSTILE}`.slice(0, 120) }],
  });
  const brief = buildBrief(inputs);
  return {
    brief,
    visuals: briefVisuals(gatherFacts(inputs)),
    project: { id: 'p1', name: inputs.project.name },
    exportedAt: '2026-02-02T09:00:00.000Z',
    appVersion: '9.9.9',
  };
}

function plainExport(): BriefExportInput {
  const inputs = richInputs();
  return {
    brief: buildBrief(inputs),
    visuals: briefVisuals(gatherFacts(inputs)),
    project: { id: 'p1', name: inputs.project.name },
    exportedAt: '2026-02-02T09:00:00.000Z',
    appVersion: '9.9.9',
  };
}

describe('the printable page', () => {
  const plain = briefHtml(plainExport());
  const hostile = briefHtml(hostileExport());

  it('is served with the same strict policy as the memo: nothing may load, run or frame', () => {
    expect(BRIEF_CSP).toBe(MEMO_CSP);
    expect(BRIEF_CSP).toContain("default-src 'none'");
    expect(BRIEF_CSP).not.toMatch(/script-src|connect-src|img-src/u);
  });

  it('has no script, no image, no link and no resource to load, and prints well', () => {
    for (const page of [plain, hostile]) {
      expect(page).not.toMatch(/<script/iu);
      expect(page).not.toMatch(/<(?:img|iframe|link|object|embed|form|a|base)\b/iu);
      // Only the page's own attributes: no address to fetch and no event handler, in any tag.
      const attributes = [...page.matchAll(/<[a-z][a-z0-9]*\s+([^>]*)>/gu)].flatMap((match) =>
        [...(match[1] ?? '').matchAll(/(?:^|\s)([a-z-]+)="/gu)].map((entry) => entry[1]),
      );
      expect(new Set(attributes)).toEqual(
        new Set(['lang', 'charset', 'name', 'content', 'id', 'class', 'scope']),
      );
      expect(page).toContain('@media print');
      expect(page).toContain('@page');
      expect(page).toContain('<html lang="en">');
    }
  });

  it('escapes every piece of text it prints, so hostile text stays text', () => {
    expect(hostile).not.toContain('<script>alert');
    expect(hostile).not.toContain('<img src=x');
    expect(hostile).toContain(
      '&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;&gt;&lt;img src=x onerror=alert(1)&gt;',
    );
    const allowed = new Set([
      'body',
      'caption',
      'dd',
      'dl',
      'dt',
      'footer',
      'h1',
      'h2',
      'head',
      'html',
      'li',
      'main',
      'meta',
      'p',
      'span',
      'style',
      'table',
      'tbody',
      'td',
      'th',
      'thead',
      'title',
      'tr',
      'ul',
    ]);
    const tags = [...hostile.matchAll(/<\/?([a-z][a-z0-9]*)/gu)].map((match) => match[1]!);
    expect(tags.filter((tag) => !allowed.has(tag))).toEqual([]);
    expect(hostile).toContain('<title>Project &lt;script&gt;');
  });

  it('is answer-first, with the seventeen sections in order, each with an anchor', () => {
    const headings = [...plain.matchAll(/<h2 id="([^"]+)">([^<]*)<\/h2>/gu)].map(
      (match) => match[1],
    );
    expect(headings).toEqual([
      'in-short',
      'executive-answer',
      'decision',
      'evidence-base',
      'stakeholders',
      'reaction-patterns',
      'alternative-outcomes',
      'first-order',
      'second-order',
      'drivers',
      'assumptions',
      'uncertainty',
      'risks-opportunities',
      'recommendations',
      'validation-plan',
      'sources',
      'limitations',
      'technical-appendix',
      'method',
    ]);
    expect(plain.indexOf('In short')).toBeLessThan(plain.indexOf('Decision evaluated'));
  });

  it('prints the sources, assumptions, configuration, limitations, timestamps and the comparison details', () => {
    expect(plain).toContain('Synthetic actors are not real people');
    expect(plain).toContain('Retrieved by this server from');
    expect(plain).toContain('Assumption register');
    expect(plain).toContain('Each alternative against the baseline, on the same seeds');
    expect(plain).toContain('Seeds and runs: 2 variants');
    expect(plain).toContain('Trait table');
    expect(plain).toContain('2026-01-15T10:00:00.000Z');
    expect(plain).toContain('2026-02-02T09:00:00.000Z');
    expect(plain).toContain('Swarm version');
    expect(plain).toContain('9.9.9');
    expect(plain).toContain('does not predict the future');
    expect(plain).toContain('Origin');
  });

  it('labels each statement with its origin in words, not only in a style', () => {
    expect(plain).toContain('<span class="origin">Simulation aggregation</span>');
    expect(plain).toContain('<span class="origin">Unresolved uncertainty</span>');
    expect(plain).toContain('<span class="reliance">Moderate reliance</span>');
    expect(plain).toContain('Evidence (supports): Supplied notes.md, passage P1');
  });
});

describe('the Markdown', () => {
  const plain = briefMarkdown(plainExport());
  const hostile = briefMarkdown(hostileExport());

  it('escapes markup so that hostile text stays inert', () => {
    expect(hostile).not.toContain('<script>');
    expect(hostile).not.toContain('<img');
    expect(hostile).toContain('&lt;script&gt;');
    expect(hostile).not.toMatch(/(?<!\\)\[click\]\(javascript/u);
    expect(hostile).toContain('\\[click\\]\\(javascript');
    expect(hostile).not.toMatch(/(?<!\\)`code`/u);
  });

  /** Rows whose number of cells is not the number of columns, which a stray pipe would cause. */
  const ragged = (markdown: string): string[] => {
    const cells = (line: string): number =>
      (line.replace(/\\\|/gu, '').match(/\|/gu) ?? []).length - 1;
    const lines = markdown.split('\n');
    const found: string[] = [];
    lines.forEach((line, index) => {
      if (!line.startsWith('| ---')) return;
      const width = cells(line);
      for (let row = index - 1; lines[row]?.startsWith('| '); row -= 1) {
        if (cells(lines[row]!) !== width) found.push(lines[row]!.slice(0, 80));
      }
      for (let row = index + 1; lines[row]?.startsWith('| '); row += 1) {
        if (cells(lines[row]!) !== width) found.push(lines[row]!.slice(0, 80));
      }
    });
    return found;
  };

  it('keeps every table row the width of its header, even when a name holds a pipe', () => {
    expect(plain.split('\n').filter((line) => line.startsWith('| ---')).length).toBeGreaterThan(6);
    expect(ragged(plain)).toEqual([]);
    expect(ragged(hostile)).toEqual([]);
  });

  it('contains the limitations, the sources, the assumptions, the configuration and the comparison', () => {
    const { brief } = plainExport();
    for (const limitation of brief.limitations.slice(0, 3)) {
      expect(plain).toContain(
        limitation.replace(/[\\`*_[\]{}()#+.!|]/gu, '\\$&').replace(/&/gu, '&amp;'),
      );
    }
    expect(plain).toContain('## 15\\. Sources and provenance');
    expect(plain).toContain('## 10\\. Important assumptions');
    expect(plain).toContain('## 17\\. Technical appendix');
    expect(plain).toContain('Seeds and runs');
    expect(plain).toContain('**Each alternative against the baseline, on the same seeds**');
    expect(plain).toContain('**Generated:** 2026-01-15T10:00:00\\.000Z');
  });

  it('puts the recommendations and the validation plan in tables with everything the page shows', () => {
    expect(plain).toContain('**Recommendations, best first**');
    expect(plain).toContain(
      '| Priority | Recommendation | Origin | Reliance | Impact | Effort | Reversibility | Owner | Horizon |',
    );
    expect(plain).toContain('**Validation plan: real-world checks, none of which has been run**');
    expect(plain).toContain('sensitivity s1');
  });

  it('opens with the notice, and says where each statement comes from', () => {
    expect(plain.startsWith('# Decision brief: Fee review')).toBe(true);
    expect(plain).toContain('> Swarm explores possible scenarios');
    expect(plain).toContain('**Simulation aggregation · Moderate reliance**');
    expect(plain).toContain('  - Finding f1:');
  });
});

describe('the JSON', () => {
  const input = hostileExport();
  const text = JSON.stringify(briefJson(input), null, 2);
  const parsed = JSON.parse(text) as {
    format: string;
    brief: unknown;
    data: { scenarioComparison: unknown[]; traitTable: unknown[] };
    provenance: Record<string, unknown>;
  };

  it('carries the brief whole, and it reads back as the same brief', () => {
    expect(parsed.format).toBe('swarm-decision-brief');
    expect(decisionBriefSchema.parse(parsed.brief)).toEqual(input.brief);
    expect(parsed.brief).toEqual(JSON.parse(JSON.stringify(input.brief)));
  });

  it('says when it was made, by which version, and from which revisions of what', () => {
    expect(parsed.provenance).toEqual({
      generatedAt: TIME,
      exportedAt: '2026-02-02T09:00:00.000Z',
      appVersion: '9.9.9',
      analysisId: 'analysis-1',
      generatedBy: 'rules',
      inputRevisions: { scenario: 1, stakeholders: 2, actors: 1, analysis: 3, critiques: 1 },
    });
  });

  it('holds the data the tables are drawn from, and keeps hostile text as a string', () => {
    expect(parsed.data.scenarioComparison).toHaveLength(1);
    expect(parsed.data.traitTable).toHaveLength(5);
    expect(text).toContain("<script>alert('x')</script>");
    expect(text).not.toContain('\u0000');
  });

  it('has no visuals when the analysis is gone, and still carries the brief', () => {
    const without = briefJson({ ...plainExport(), visuals: null }) as {
      data: unknown;
      brief: unknown;
    };
    expect(without.data).toBeNull();
    expect(without.brief).toBeTruthy();
    expect(briefMarkdown({ ...plainExport(), visuals: null })).toContain(
      '## 5\\. Main reaction patterns',
    );
    expect(briefHtml({ ...plainExport(), visuals: null })).not.toContain(
      'Each alternative against the baseline',
    );
  });
});

describe('the data behind the charts', () => {
  const inputs = richInputs();
  const visuals = briefVisuals(gatherFacts(inputs));
  const analysis = inputs.analysis;

  it('counts simulated members from the recorded runs, variant by variant', () => {
    const members = analysis.actors.reduce((total, actor) => total + actor.sampleSize, 0);
    expect(visuals.outcomeDistribution.map((row) => row.variantId)).toEqual([
      'baseline',
      'proposed-change',
    ]);
    for (const row of visuals.outcomeDistribution) {
      const runs = analysis.variants.find((variant) => variant.variantId === row.variantId)!.runs;
      expect(row.members).toBe(members);
      expect(row.runs).toBe(runs.length);
      const adverse = runs.map(
        (run) => (run.responseShares.resist + run.responseShares.switch) * members,
      );
      expect(row.adverse.mean).toBeCloseTo(adverse.reduce((a, b) => a + b, 0) / adverse.length, 6);
      expect(row.adverse.min).toBeCloseTo(Math.min(...adverse), 6);
      expect(row.adverse.max).toBeCloseTo(Math.max(...adverse), 6);
      const total = row.responses.reduce((sum, entry) => sum + entry.mean, 0);
      expect(total).toBeCloseTo(members, 6);
    }
  });

  it('compares each alternative with the baseline on the same seeds, and names the finding that states it', () => {
    const [row] = visuals.scenarioComparison;
    expect(row).toMatchObject({
      variantId: 'proposed-change',
      pairedRuns: 10,
      worseInRuns: 10,
      findingId: 'f1',
      classification: 'mostly-repeatable',
      holdsIn: 10,
      of: 10,
    });
    expect(row!.adverseDelta).toBeCloseTo(row!.adverseMean - row!.baselineAdverseMean!, 6);
    expect(row!.stanceDelta).toBeLessThan(0);
  });

  it('lists the evidence behind each stakeholder and marks the ones with none', () => {
    const subscribers = visuals.evidenceMap.find((row) => row.stakeholderId === 'subscribers')!;
    expect(subscribers).toMatchObject({ supporting: 2, contradicting: 0, gap: false });
    expect(subscribers.documents).toEqual(['Public page', 'Supplied notes.md']);
    expect(
      visuals.evidenceMap
        .filter((row) => row.gap)
        .map((row) => row.stakeholderId)
        .sort(),
    ).toEqual(['provider', 'regulator', 'resellers', 'rival-provider']);
    expect(visuals.stakeholderMap.map((group) => group.label)).toEqual([
      'Decision maker',
      'Bears cost',
      'Competitor',
      'Partner',
      'Regulator',
    ]);
  });

  it('shows what each moved assumption did, with where it came from and whether it is evidenced', () => {
    const rows = Object.fromEntries(visuals.sensitivity.map((row) => [row.id, row]));
    expect(rows['s1']).toMatchObject({
      origin: 'system-assumption',
      evidenced: false,
      shift: -0.18,
    });
    expect(rows['s2']).toMatchObject({ origin: 'supplied-evidence', evidenced: true });
    expect(rows['s4']).toMatchObject({ origin: 'user-assumption', classification: 'robust' });
    expect(visuals.sensitivity.map((row) => row.id)).toEqual(['s3', 's1', 's2', 's5', 's4']);
    expect(visuals.assumptionRegister[0]).toMatchObject({ sensitive: true });
  });

  it('holds every trait of every actor with its origin, and what each reference points at', () => {
    expect(visuals.traitTable).toHaveLength(5);
    expect(visuals.traitTable[0]?.traits).toHaveLength(11);
    expect(visuals.traitTable[1]?.traits[0]).toMatchObject({
      key: 'priorStance',
      origin: 'system-assumption',
    });
    expect(visuals.lookups.findings.map((finding) => finding.id)).toEqual(['f1', 'f2', 'f3', 'f4']);
    expect(visuals.lookups.documents.map((document) => document.origin)).toEqual([
      'supplied-evidence',
      'retrieved-public-evidence',
      'supplied-evidence',
      'historical-comparison',
    ]);
    expect(visuals.lookups.stakeholders.map((entry) => entry.id).sort()).toEqual([
      'provider',
      'regulator',
      'resellers',
      'rival-provider',
      'subscribers',
    ]);
    expect(visuals.analysisId).toBe('analysis-1');
  });
});
