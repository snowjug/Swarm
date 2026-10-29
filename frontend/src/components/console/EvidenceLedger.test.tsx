import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ChatGrounding } from '../../../../shared/types';
import { claimRecord, conflictRecord, ledgerFixture, sufficiency } from '../../test/ledger';
import { visibleText } from '../../test/provider';
import { ConflictCard } from './ConflictCard';
import { Citations } from './Citations';
import { LedgerBody } from './EvidenceLedger';
import { ChatGroundingNote, SufficiencyBanner, ToneChip } from './LedgerParts';

const render = (node: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(node);
const text = (html: string): string => visibleText(html);

describe('LedgerBody', () => {
  const html = render(
    createElement(LedgerBody, { projectId: 'p1', ledger: ledgerFixture(), onChanged: () => {} }),
  );

  it('opens with whether the evidence supports a recommendation, as a status region', () => {
    expect(html).toContain('role="status"');
    expect(text(html)).toContain('The evidence is limited');
    expect(text(html)).toContain('Only 1 directly supported finding.');
  });

  it('summarises how many statements are findings, labelled, withheld and reviewed', () => {
    expect(text(html)).toContain('3 statements');
    expect(text(html)).toContain('1 shown as findings');
    expect(text(html)).toContain('2 labelled as hypotheses, simulation or inputs');
    expect(text(html)).toContain('1 reviewed');
  });

  it('lists every statement with its type, support class and publication status in words', () => {
    for (const phrase of [
      'The council counted 412,000 crossings in 2025.',
      'Source fact',
      'Directly supported',
      'AI hypothesis',
      'Not checkable',
      'Labelled not verified',
      'Unsupported',
      'Labelled hypothesis',
      'Rejected by a reviewer',
    ]) {
      expect(text(html)).toContain(phrase);
    }
  });

  it('gives every chip an icon as well as words, so colour is never the only cue', () => {
    const chips = html.match(/<span class="tone-chip[^>]*>[\s\S]*?<\/span>/gu) ?? [];
    expect(chips.length).toBeGreaterThan(5);
    for (const chip of chips) expect(chip).toContain('<svg');
  });

  it('shows the conflict, both quotations and both documents, without declaring either true', () => {
    expect(text(html)).toContain('Conflicts between sources (1 open of 1)');
    expect(text(html)).toContain('council-briefing.md');
    expect(text(html)).toContain('operator-memo.md');
    expect(text(html)).toContain('412,000');
    expect(text(html)).toContain('365,000');
    expect(text(html)).toContain('Neither passage is declared true');
  });

  it('makes each statement a labelled, pressable control and the filters labelled fields', () => {
    expect(html).toMatch(/<button[^>]*class="ledger-claim"[^>]*aria-pressed="false"/u);
    expect(html).toContain('aria-label="Filter statements"');
    for (const label of ['Support', 'Shown as', 'Not yet reviewed']) {
      expect(text(html)).toContain(label);
    }
    expect(text(html)).toContain('Showing 3 of 3');
  });

  it('says so, rather than showing an empty box, when nothing was detected or listed', () => {
    const empty = text(
      render(
        createElement(LedgerBody, {
          projectId: 'p1',
          ledger: ledgerFixture({ claims: [], contradictions: [], reviewedAt: null }),
          onChanged: () => {},
        }),
      ),
    );
    expect(empty).toContain('No conflicts between sources detected');
    expect(empty).toContain('absence of a conflict here is not proof that the sources agree');
    expect(empty).toContain('No statement-level review exists for this report');
  });

  it('explains an empty review as the review listing nothing, when one ran', () => {
    const reviewed = text(
      render(
        createElement(LedgerBody, {
          projectId: 'p1',
          ledger: ledgerFixture({ claims: [] }),
          onChanged: () => {},
        }),
      ),
    );
    expect(reviewed).toContain('The grounding review listed no statements.');
  });

  it('renders hostile statement and source text as text, never as markup', () => {
    const hostile = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const markup = render(
      createElement(LedgerBody, {
        projectId: 'p1',
        ledger: ledgerFixture({
          claims: [claimRecord({ text: hostile })],
          contradictions: [conflictRecord({ left: { ...conflictRecord().left, quote: hostile } })],
        }),
        onChanged: () => {},
      }),
    );
    expect(markup).not.toContain('<script>');
    expect(markup).not.toContain('<img src=x');
    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('SufficiencyBanner', () => {
  it('words each level distinctly and shows the share of source-backed statements', () => {
    const levels = ['sufficient', 'limited', 'insufficient'] as const;
    const headlines = levels.map((level) =>
      text(render(createElement(SufficiencyBanner, { sufficiency: sufficiency(level) }))),
    );
    expect(new Set(headlines).size).toBe(3);
    expect(headlines[2]).toContain('not enough for a recommendation');
    const share = text(
      render(
        createElement(SufficiencyBanner, {
          sufficiency: sufficiency('limited', { directlySupportedShare: 0.42 }),
        }),
      ),
    );
    expect(share).toContain('42% of the statements that rest on a source');
  });
});

describe('ChatGroundingNote', () => {
  const note = (status: ChatGrounding['status'], notes: string[] = []) =>
    render(createElement(ChatGroundingNote, { grounding: { status, notes, coverage: null } }));

  it('states what each outcome means for the reader', () => {
    expect(text(note('cited'))).toContain('Cited from project evidence');
    expect(text(note('caveated'))).toContain('some figures in it were not found');
    expect(text(note('abstained'))).toContain('Not enough evidence to answer');
    expect(text(note('uncited'))).toContain('Treat it as unverified');
  });

  it('lists the notes as text', () => {
    const html = note('abstained', ['Not found in the project: <b>france</b>']);
    expect(html).toContain('&lt;b&gt;france&lt;/b&gt;');
    expect(html).not.toContain('<b>france');
  });

  it('falls back to "unverified" for a status this build does not know', () => {
    const html = render(
      createElement(ChatGroundingNote, {
        grounding: {
          status: 'from-the-future' as ChatGrounding['status'],
          notes: [],
          coverage: null,
        },
      }),
    );
    expect(text(html)).toContain('No citation: unverified');
  });
});

describe('ConflictCard', () => {
  const card = (status: Parameters<typeof conflictRecord>[0] = {}) =>
    render(
      createElement(ConflictCard, {
        projectId: 'p1',
        conflict: conflictRecord(status),
        onChanged: () => {},
      }),
    );

  it('offers review only while the conflict is open', () => {
    for (const status of ['detected', 'confirmed'] as const) {
      expect(text(card({ status }))).toContain('Confirm conflict');
    }
    for (const status of ['dismissed', 'resolved'] as const) {
      expect(text(card({ status }))).not.toContain('Confirm conflict');
    }
  });

  it('labels the note field and shows a reviewer note as text', () => {
    const html = card({ note: 'Different routes <i>entirely</i>', status: 'dismissed' });
    expect(html).toContain('&lt;i&gt;entirely&lt;/i&gt;');
    expect(text(card())).toContain('Note (optional)');
  });

  it('says what kind of disagreement it is', () => {
    expect(text(card({ kind: 'numeric' }))).toContain('Different figures');
    expect(text(card({ kind: 'polarity' }))).toContain('Opposite statements');
  });
});

describe('Citations of report statements', () => {
  it('labels the statements an answer cites, once each, as text and not as links', () => {
    const html = render(
      createElement(Citations, {
        sourceIds: [],
        claimIds: ['C3', 'C3', 'C1'],
        onInspect: () => {},
      }),
    );
    expect(text(html)).toContain('Report statements');
    expect(html.match(/class="claim-ref/gu)).toHaveLength(2);
    expect(html).not.toMatch(/<button[^>]*>\s*C3/u);
  });

  it('shows nothing for an answer that cites no statement', () => {
    const html = render(createElement(Citations, { sourceIds: ['S1'], onInspect: () => {} }));
    expect(text(html)).not.toContain('Report statements');
  });
});

describe('ToneChip', () => {
  it('shows its label and an icon', () => {
    const html = render(createElement(ToneChip, { tone: 'bad', label: 'Withheld' }));
    expect(html).toContain('tone-bad');
    expect(html).toContain('<svg');
    expect(text(html)).toBe('Withheld');
  });
});
