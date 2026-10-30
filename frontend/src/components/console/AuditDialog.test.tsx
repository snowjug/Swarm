import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AuditEntry } from '../../../../shared/types';
import type { AuditState } from '../../hooks/useAudit';
import { visibleText } from '../../test/provider';
import { AuditLog } from './AuditDialog';

const entry = (seq: number, overrides: Partial<AuditEntry> = {}): AuditEntry => ({
  seq,
  at: '2026-10-29T10:00:00.000Z',
  actor: 'local-user',
  action: 'step.started',
  targetType: 'project',
  targetId: 'de300001-0000-4000-8000-000000000001',
  projectId: 'de300001-0000-4000-8000-000000000001',
  detail: { step: 'knowledge', resume: false },
  prevHash: '0'.repeat(64),
  hash: '1'.repeat(64),
  ...overrides,
});

function state(overrides: Partial<AuditState> = {}): AuditState {
  return {
    entries: [],
    loading: false,
    error: null,
    reload: () => {},
    verification: { state: 'idle' },
    verify: () => {},
    ...overrides,
  };
}

const render = (overrides: Partial<AuditState> = {}): string =>
  renderToStaticMarkup(<AuditLog state={state(overrides)} />);

describe('the audit log view', () => {
  it('lists entries newest first, in words, as a table a screen reader can navigate', () => {
    const html = render({
      entries: [
        entry(1, { action: 'project.created', detail: { workflow: 'guided', actors: 6 } }),
        entry(2),
        entry(3, { action: 'export.downloaded', detail: { format: 'json' } }),
      ],
    });
    const text = visibleText(html);
    expect(text.indexOf('Export downloaded')).toBeLessThan(text.indexOf('Stage started'));
    expect(text.indexOf('Stage started')).toBeLessThan(text.indexOf('Project created'));
    expect(text).toContain('format: json');
    expect(text).toContain('workflow: guided · actors: 6');
    expect(text).toContain('step: knowledge · resume: no');
    expect(html).toContain('<caption class="sr-only">Audit log entries, newest first</caption>');
    expect(html.match(/<th scope="col">/gu)).toHaveLength(5);
    expect(html).toContain('role="region"');
    expect(html).toContain('tabindex="0"');
  });

  it('says what the log holds, and that it holds no content', () => {
    const text = visibleText(render());
    expect(text).toMatch(/never questions, answers or source text/u);
    expect(text).toMatch(/commits to the one before it/u);
  });

  it('shows an empty log as empty, and a loading one as loading', () => {
    expect(visibleText(render({ entries: [] }))).toContain('No recorded actions yet');
    const loading = render({ entries: null, loading: true });
    expect(visibleText(loading)).toContain('Reading the audit log');
    expect(loading).not.toContain('No recorded actions yet');
  });

  it('shows a failure with a way to retry, and no table', () => {
    const html = render({ entries: null, error: 'Your role does not allow this action.' });
    expect(visibleText(html)).toContain('The audit log could not be read');
    expect(visibleText(html)).toContain('Your role does not allow this action.');
    expect(html).toContain('Retry');
    expect(html).not.toContain('<table');
  });

  it('reports an intact chain, a broken one, a check that could not run, and one in progress', () => {
    const intact = visibleText(
      render({
        verification: { state: 'done', result: { ok: true, checked: 42, brokenAt: null } },
      }),
    );
    expect(intact).toContain('Chain intact');
    expect(intact).toContain('42 entries checked');

    const broken = visibleText(
      render({ verification: { state: 'done', result: { ok: false, checked: 7, brokenAt: 8 } } }),
    );
    expect(broken).toContain('Chain broken');
    expect(broken).toContain('Entry #8 does not match');
    expect(broken).toContain('after 7 entries that did');

    expect(
      visibleText(
        render({
          verification: { state: 'failed', error: 'Your role does not allow this action.' },
        }),
      ),
    ).toContain('Integrity could not be checked');

    const running = render({ verification: { state: 'running' } });
    expect(visibleText(running)).toContain('Recomputing the hash chain');
    expect(running).toMatch(/<button[^>]*disabled=""[^>]*>[^]*Verify integrity/u);
  });
});
