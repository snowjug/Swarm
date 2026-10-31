import { afterEach, describe, expect, it, vi } from 'vitest';
import { LedgerService } from '../src/grounding/service.js';
import { MEMO_CSP } from '../src/studio/export.js';
import { StudioService } from '../src/studio/service.js';
import {
  CANARY,
  closeApplications,
  generatedReport,
  harness,
  idsIn,
  under,
} from './support/studio-world.js';

// Report Studio over HTTP, on a project whose report and statements are written out in
// support/studio-world.ts, so that what each statement may be called is known before the studio is asked.

afterEach(async () => {
  vi.restoreAllMocks();
  await closeApplications();
});
describe('opening the studio', () => {
  it('has nothing to show until someone opens it, and says what is missing', async () => {
    const { view, project } = await harness();
    const before = await view();
    expect(before).toMatchObject({
      document: null,
      stale: false,
      reportReady: true,
      capabilities: { edit: true, review: true, export: true },
      report: { title: 'Ferry report' },
    });
    // A local-mode project has no model that could write a chapter again, and the reason says so.
    expect(before.regeneration.available).toBe(false);
    expect(before.regeneration.reason).toMatch(/no model/u);
    expect(project.id).toBeTruthy();
  });

  it('is not there for a project whose report does not exist yet, and cannot be opened', async () => {
    const { view, call } = await harness({ report: false });
    expect(await view()).toMatchObject({ document: null, reportReady: false, report: null });
    const refused = await call('POST', '', {});
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('REPORT_NOT_READY');
  });

  it('opens from the generated report, with what a person needs to judge each statement', async () => {
    const { start } = await harness();
    const opened = await start();
    const doc = opened.document!;
    expect(doc).toMatchObject({ state: 'draft', revision: 1, approval: null });
    expect(doc.sections.map((s) => s.id)).toEqual(['summary', 'S1', 'S2', 'limitations']);
    const evidence = doc.sections.find((s) => s.id === 'S1')!;
    const outlook = doc.sections.find((s) => s.id === 'S2')!;
    expect(evidence.statements.map((s) => s.id)).toEqual(['C1', 'C2', 'C3', 'C4']);
    expect(outlook.statements.map((s) => s.id)).toEqual(['C5', 'C6', 'C7']);
    expect([evidence.statementsCurrent, outlook.statementsCurrent]).toEqual([true, true]);
    // Each statement carries its type, its support and what the policy lets the product do with it.
    const publication = Object.fromEntries(
      [...evidence.statements, ...outlook.statements].map((s) => [s.id, s.publication.status]),
    );
    expect(publication).toEqual({
      C1: 'finding',
      C2: 'qualified',
      C3: 'labelled-unverified',
      C4: 'contradiction-shown',
      C5: 'labelled-hypothesis',
      C6: 'contradiction-shown',
      C7: 'labelled-simulation',
    });
    // The whole passages behind the statements, the assumptions, and the open conflict are there.
    expect(opened.passages.map((p) => p.id).sort()).toEqual(['S1', 'S2']);
    expect(opened.assumptions.length).toBeGreaterThan(0);
    expect(opened.conflicts.map((c) => c.id)).toEqual(['X1']);
    expect(opened.limits).toMatchObject({ maxBody: 12_000, maxVersions: 100 });
  });

  it('does not open twice, and does not change the generated report', async () => {
    const { start, call, repository, project } = await harness();
    const report = JSON.stringify(repository.get(project.id).report);
    await start();
    const again = await call('POST', '', {});
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('STUDIO_CURRENT');
    expect(JSON.stringify(repository.get(project.id).report)).toBe(report);
  });
});

describe('working on a section', () => {
  it('keeps what a person writes apart from what was generated, and the statements with the text they describe', async () => {
    const { start, edit, view, sectionOf } = await harness();
    await start();
    const response = await edit('S1', `The evidence chapter, in my words. ${CANARY}`);
    expect(response.statusCode, response.body).toBe(200);
    const section = sectionOf(await view(), 'S1');
    expect(section).toMatchObject({ version: 2, origin: 'human' });
    expect(section.body).toContain('in my words');
    expect(section.versions.map((v) => [v.version, v.origin])).toEqual([
      [1, 'generated'],
      [2, 'human'],
    ]);
    // Its statements describe the generated text: they are still shown, marked as not describing this one.
    expect(section.statements.map((s) => s.id)).toEqual(['C1', 'C2', 'C3', 'C4']);
    expect(section.statementsCurrent).toBe(false);
    // The other chapter is untouched.
    expect(sectionOf(await view(), 'S2')).toMatchObject({ version: 1, statementsCurrent: true });
  });

  it('refuses a second edit made on the version someone else has already changed', async () => {
    const { start, call, view, sectionOf } = await harness();
    await start();
    const first = { body: 'First person’s text.', expectedVersion: 1, reason: null };
    expect((await call('PUT', '/sections/S1', first)).statusCode).toBe(200);
    const second = await call('PUT', '/sections/S1', { ...first, body: 'Second person’s text.' });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('SECTION_CONFLICT');
    expect(sectionOf(await view(), 'S1').body).toBe('First person’s text.');
  });

  it('lets two people change different sections at once, and applies a change again after losing the race', async () => {
    const { start, call, view, sectionOf, repository, project } = await harness();
    await start();
    const someoneElse = new StudioService(repository, new LedgerService(repository));
    const realAtomic = repository.atomic.bind(repository);
    let raced = false;
    vi.spyOn(repository, 'atomic').mockImplementation((operation) => {
      if (!raced) {
        raced = true;
        // Between this request reading the document and saving it, another person saves.
        someoneElse.setLock(project.id, 'S2', true, 'someone-else');
      }
      return realAtomic(operation);
    });
    const mine = await call('PUT', '/sections/S1', {
      body: 'My text for the first chapter.',
      expectedVersion: 1,
      reason: null,
    });
    expect(mine.statusCode, mine.body).toBe(200);
    const after = await view();
    expect(sectionOf(after, 'S1').body).toBe('My text for the first chapter.');
    expect(sectionOf(after, 'S2').locked).toMatchObject({ actor: 'someone-else' });
    // Both changes are in the document, one revision each, with nothing lost.
    expect(after.document!.revision).toBe(3);
  });

  it('refuses to change a locked section until it is unlocked', async () => {
    const { start, call, edit } = await harness();
    await start();
    expect((await call('PUT', '/sections/S1/lock', { locked: true })).statusCode).toBe(200);
    const refused = await edit('S1', 'Text for a locked section.');
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('SECTION_LOCKED');
    expect((await call('PUT', '/sections/S1/lock', { locked: false })).statusCode).toBe(200);
    expect((await edit('S1', 'Text for an unlocked section.')).statusCode).toBe(200);
  });

  it('restores an earlier version as a new one', async () => {
    const { start, call, edit, view, sectionOf } = await harness();
    await start();
    await edit('S1', 'A different text.');
    const restored = await call('POST', '/sections/S1/restore', {
      version: 1,
      expectedVersion: 2,
      reason: 'The first was better',
    });
    expect(restored.statusCode, restored.body).toBe(200);
    const section = sectionOf(await view(), 'S1');
    expect(section).toMatchObject({ version: 3, body: 'Body of the evidence chapter.' });
    expect(section.versions.at(-1)).toMatchObject({
      restoredFrom: 1,
      reason: 'The first was better',
    });
    // The statements that were checked against that text describe it again.
    expect(section.statementsCurrent).toBe(true);
  });

  it('keeps a reviewer’s notes with the section, and does not let one be edited or removed', async () => {
    const { start, call, view, sectionOf } = await harness();
    await start();
    const added = await call('POST', '/sections/S2/notes', {
      text: 'Where does the 50% come from?',
    });
    expect(added.statusCode).toBe(201);
    expect(sectionOf(await view(), 'S2').notes).toMatchObject([
      { text: 'Where does the 50% come from?', actor: 'local-user' },
    ]);
    // There is no route to change or delete a note: the table of routes has none.
    expect((await call('PUT', '/sections/S2/notes', { text: 'x' })).statusCode).toBe(404);
  });

  it('refuses input it does not understand, and says which section does not exist', async () => {
    const { start, call } = await harness();
    await start();
    const refused = [
      await call('PUT', '/sections/S1', {
        body: 'x'.repeat(12_001),
        expectedVersion: 1,
        reason: null,
      }),
      await call('PUT', '/sections/S1', {
        body: 'Fine text.',
        expectedVersion: 1,
        reason: null,
        extra: true,
      }),
      await call('PUT', '/sections/S1', { body: 'Fine text.', expectedVersion: 0, reason: null }),
      await call('PUT', '/sections/S100', { body: 'Fine text.', expectedVersion: 1, reason: null }),
      await call('PUT', '/sections/..%2Fsummary', {
        body: 'Fine text.',
        expectedVersion: 1,
        reason: null,
      }),
      await call('POST', '/sections/S1/notes', { text: '   ' }),
      await call('PUT', '/sections/S1/lock', { locked: 'yes' }),
    ];
    expect(refused.map((r) => r.statusCode)).toEqual([400, 400, 400, 400, 400, 400, 400]);
    const missing = await call('PUT', '/sections/S9', {
      body: 'Fine text.',
      expectedVersion: 1,
      reason: null,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('SECTION_NOT_FOUND');
  });
});

describe('the review workflow', () => {
  it('moves from draft to review to approved, and freezes the text while it is under review or approved', async () => {
    const { start, call, edit, transition, view } = await harness();
    await start();
    expect((await transition('submit')).statusCode).toBe(200);
    expect((await view()).document!.state).toBe('in-review');
    const frozen = await edit('S1', 'A change while the reviewer reads.');
    expect(frozen.statusCode).toBe(409);
    expect(frozen.json().error.code).toBe('STUDIO_NOT_EDITABLE');
    // A reviewer may still leave a note.
    expect((await call('POST', '/sections/S1/notes', { text: 'Read it twice.' })).statusCode).toBe(
      201,
    );
    expect((await transition('approve')).statusCode).toBe(200);
    const approved = (await view()).document!;
    expect(approved).toMatchObject({ state: 'approved', approval: { actor: 'local-user' } });
    expect((await edit('S1', 'A change after approval.')).json().error.code).toBe(
      'STUDIO_NOT_EDITABLE',
    );
  });

  it('approves the revision the reviewer looked at, and no other', async () => {
    const { start, call, view } = await harness();
    await start();
    const opened = await view();
    await call('POST', '/submit', { expectedRevision: opened.document!.revision, note: null });
    const looked = (await view()).document!.revision;
    // A note is left after the reviewer opened the report: what they saw is no longer all of it.
    await call('POST', '/sections/S1/notes', { text: 'New remark.' });
    const refused = await call('POST', '/approve', { expectedRevision: looked, note: null });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('STUDIO_CHANGED');
    expect((await view()).document!.state).toBe('in-review');
  });

  it('needs a reason to send it back or to reopen it, and lets the author fix and submit again', async () => {
    const { start, edit, transition, view } = await harness();
    await start();
    await transition('submit');
    expect((await transition('request-changes')).json().error.code).toBe('NOTE_REQUIRED');
    expect(
      (await transition('request-changes', 'The ridership figure needs a source.')).statusCode,
    ).toBe(200);
    expect((await view()).document).toMatchObject({ state: 'changes-requested' });
    expect((await edit('S1', 'The figure now has its source.')).statusCode).toBe(200);
    expect((await transition('submit')).statusCode).toBe(200);
    await transition('approve');
    expect((await transition('reopen')).json().error.code).toBe('NOTE_REQUIRED');
    expect((await transition('reopen', 'New evidence arrived.')).statusCode).toBe(200);
    const reopened = (await view()).document!;
    expect(reopened).toMatchObject({ state: 'draft', approval: null });
    expect(reopened.decisions.map((d) => d.action)).toEqual([
      'started',
      'submitted',
      'changes-requested',
      'submitted',
      'approved',
      'reopened',
    ]);
  });

  it('refuses a step from the wrong state, with the state it needs', async () => {
    const { start, transition } = await harness();
    await start();
    const refused = await transition('approve');
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({ code: 'STUDIO_STATE' });
    expect(refused.json().error.message).toContain('in review');
  });
});

describe('what leaves the studio', () => {
  it('prints a memo that says it is a draft until a reviewer approves it, and then matches it to the approval', async () => {
    const { start, call, transition } = await harness();
    await start();
    const draft = await call('GET', '/export?format=memo');
    expect(draft.statusCode).toBe(200);
    expect(draft.headers['content-type']).toContain('text/html');
    expect(draft.headers['content-security-policy']).toBe(MEMO_CSP);
    expect(draft.headers['x-content-type-options']).toBe('nosniff');
    expect(draft.body).toContain('DRAFT: NOT APPROVED');
    expect(draft.body).not.toMatch(/<script/iu);
    await transition('submit');
    expect((await call('GET', '/export?format=memo')).body).toContain('IN REVIEW: NOT APPROVED');
    await transition('approve');
    const approved = (await call('GET', '/export?format=memo')).body;
    expect(approved).toContain('<strong>APPROVED</strong>');
    const json = (await call('GET', '/export?format=json')).json();
    expect(json.record.approval).toMatchObject({ actor: 'local-user' });
    // The printed memo carries the hash of exactly the text that was approved.
    expect(approved).toContain(json.record.contentHash);
  });

  it('says APPROVAL NOT CURRENT, and never APPROVED, for an approval whose text has since changed', async () => {
    const { start, call, transition, repository, project } = await harness();
    await start();
    await transition('submit');
    await transition('approve');
    const approved = repository.studio.get(project.id)!;
    // Nothing the application offers can change an approved report. Damage or tampering could, and a
    // memo must not then claim an approval that was given to other words.
    const tampered = {
      ...approved,
      sections: approved.sections.map((section) =>
        section.id === 'S1' ? { ...section, body: 'Words nobody approved.' } : section,
      ),
    };
    expect(repository.studio.save(project.id, tampered, approved.revision)).toBe(true);

    const memo = (await call('GET', '/export?format=memo')).body;
    expect(memo).toContain('<strong>APPROVAL NOT CURRENT</strong>');
    expect(memo).not.toContain('<strong>APPROVED</strong>');
    expect(memo).toContain('class="status open"');
    expect(memo).toContain('Do not rely on the approval.');
    const markdown = (await call('GET', '/export?format=markdown')).body;
    expect(markdown).toContain('**Status:** APPROVAL NOT CURRENT');
    const json = (await call('GET', '/export?format=json')).json();
    expect(json.status).toMatchObject({ label: 'APPROVAL NOT CURRENT', approved: false });
  });

  it('lists as findings only what the sources directly support, and labels everything else', async () => {
    const { start, call } = await harness();
    await start();
    const html = (await call('GET', '/export?format=memo')).body;
    expect(idsIn(under(html, 'What the sources support'))).toEqual(['C1', 'C2']);
    expect(under(html, 'What the sources support')).toContain('Only partly supported');
    // A statement a source contradicts, and one an open conflict touches, are shown with the evidence against.
    expect(idsIn(under(html, 'Evidence against'))).toEqual(['C4', 'C6']);
    expect(under(html, 'Evidence against')).toContain('Contradicted by');
    expect(under(html, 'Evidence against')).toContain('Open conflicts between sources');
    expect(idsIn(under(html, 'Simulation results (not real-world evidence)'))).toEqual(['C7']);
    expect(idsIn(under(html, 'Hypotheses and statements that are not verified'))).toEqual([
      'C5',
      'C3',
    ]);
    // The unsupported statement is never among the findings.
    expect(under(html, 'What the sources support')).not.toContain('Ferry fares will halve');
  });

  it('does not call a statement a finding once the text it was checked against has changed', async () => {
    const { start, call, edit } = await harness();
    await start();
    await edit('S1', 'The evidence chapter, rewritten by a person.');
    const html = (await call('GET', '/export?format=memo')).body;
    // The evidence chapter's statements are no longer listed as findings; the outlook's are unaffected.
    expect(idsIn(under(html, 'What the sources support'))).toEqual([]);
    expect(under(html, 'What the sources support')).toContain(
      'No statement in this report is directly supported',
    );
    expect(under(html, 'Left out of the lists above')).toContain('Evidence: its text was changed');
    expect(under(html, 'The report as written')).toContain(
      'Written by a person; not checked statement by statement',
    );
    expect(idsIn(under(html, 'Hypotheses and statements that are not verified'))).toEqual(['C5']);
  });

  it('leaves out a statement a reviewer rejected, and says that it did', async () => {
    const { start, call, app, project } = await harness();
    await start();
    const rejected = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/claims/C1/review`,
      payload: { result: 'rejected', note: 'Not what the council said.' },
    });
    expect(rejected.statusCode, rejected.body).toBe(200);
    const html = (await call('GET', '/export?format=memo')).body;
    expect(idsIn(under(html, 'What the sources support'))).toEqual(['C2']);
    expect(under(html, 'Left out of the lists above')).toContain(
      '1 statement(s) were rejected by a reviewer',
    );
  });

  it('escapes everything it prints, so a hostile section, note or source name stays text', async () => {
    const { start, call, edit } = await harness({
      documentName: '<b onmouseover=alert(1)>council.md',
    });
    await start();
    const hostile = `<script>alert('x')</script> & "><img src=x onerror=alert(1)> ${CANARY}`;
    await edit('S2', hostile);
    await call('POST', '/sections/S2/notes', { text: hostile });
    const memo = (await call('GET', '/export?format=memo')).body;
    expect(memo).not.toContain('<script>alert');
    expect(memo).not.toContain('<img src=x');
    // The source's name, which a person chose and a source supplied, is text too.
    expect(memo).not.toContain('<b onmouseover');
    expect(memo).toContain('&lt;b onmouseover=alert(1)&gt;council.md');
    expect(memo).toContain(
      '&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;&gt;&lt;img src=x onerror=alert(1)&gt;',
    );
    // Every tag in the page is one the memo wrote itself.
    const allowed = new Set([
      'body',
      'br',
      'div',
      'footer',
      'h1',
      'h2',
      'h3',
      'head',
      'html',
      'li',
      'main',
      'meta',
      'p',
      'q',
      'span',
      'strong',
      'style',
      'title',
      'ul',
    ]);
    const tags = [...memo.matchAll(/<\/?([a-z][a-z0-9]*)/gu)].map((match) => match[1]!);
    expect(tags.filter((tag) => !allowed.has(tag))).toEqual([]);
    const markdown = (await call('GET', '/export?format=markdown')).body;
    expect(markdown).not.toContain('<script>');
    expect(markdown).toContain('&lt;script&gt;');
    // JSON is data: the text is there as it was written, inside a string.
    const json = (await call('GET', '/export?format=json')).json();
    expect(json.document.sections.find((s: { id: string }) => s.id === 'S2').body).toBe(hostile);
  });

  it('writes the whole document as Markdown, saying which statements describe which text', async () => {
    const { start, call, edit } = await harness();
    await start();
    await edit('S1', 'Edited evidence text.');
    await call('POST', '/sections/S2/notes', { text: 'A reviewer remark.' });
    const response = await call('GET', '/export?format=markdown');
    expect(response.headers['content-type']).toContain('text/markdown');
    expect(response.headers['content-disposition']).toContain('attachment');
    const markdown = response.body;
    expect(markdown).toContain('# Ferry report');
    expect(markdown).toContain(
      'Swarm explores possible scenarios. It does not predict the future.',
    );
    expect(markdown).toContain(
      'Statements checked against an earlier text of this section (they do not describe the text above)',
    );
    expect(markdown).toContain('Statements checked against this text');
    expect(markdown).toContain('A reviewer remark');
    expect(markdown).toContain(
      'Written by a person; not checked statement by statement; version 2',
    );
  });

  it('writes the document as JSON for another tool, with its evidence', async () => {
    const { start, call } = await harness();
    await start();
    const response = await call('GET', '/export?format=json');
    expect(response.headers['content-disposition']).toContain('attachment');
    const json = response.json();
    expect(json).toMatchObject({
      format: 'swarm-report-studio',
      schemaVersion: 1,
      notice: 'Swarm explores possible scenarios. It does not predict the future.',
      status: { label: 'DRAFT: NOT APPROVED', approved: false },
      stale: false,
    });
    expect(json.document.sections).toHaveLength(4);
    expect(json.evidence.passages.map((p: { id: string }) => p.id).sort()).toEqual(['S1', 'S2']);
    expect(json.openConflicts).toHaveLength(1);
  });

  it('records every export in the audit log, with the format and nothing else about it', async () => {
    const { start, call, repository, project } = await harness();
    await start();
    for (const format of ['markdown', 'json', 'memo'])
      await call('GET', `/export?format=${format}`);
    expect((await call('GET', '/export?format=pdf')).statusCode).toBe(400);
    const exported = repository.audit
      .list({ projectId: project.id, limit: 200 })
      .filter((event) => event.action === 'studio.exported');
    expect(exported.map((event) => event.detail.format)).toEqual(['markdown', 'json', 'memo']);
    expect(JSON.stringify(exported)).not.toContain('Ferry');
  });

  it('cannot export what nobody has opened', async () => {
    const { call } = await harness();
    const refused = await call('GET', '/export?format=memo');
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('STUDIO_NOT_STARTED');
  });
});

describe('what the audit log is told', () => {
  it('records who did what to which section, with ids and counts and never the text', async () => {
    const { start, call, edit, transition, repository, project } = await harness();
    await start();
    await edit('S1', `Evidence text ${CANARY}`);
    await call('PUT', '/sections/S1/lock', { locked: true });
    await call('PUT', '/sections/S1/lock', { locked: false });
    await call('POST', '/sections/S2/notes', { text: `A note ${CANARY}` });
    await call('POST', '/sections/S1/restore', {
      version: 1,
      expectedVersion: 2,
      reason: `Because ${CANARY}`,
    });
    await transition('submit');
    await transition('request-changes', `Send back ${CANARY}`);
    await transition('submit');
    await transition('approve', `Approved ${CANARY}`);
    await transition('reopen', `Reopen ${CANARY}`);
    await call('GET', '/export?format=json');
    const events = repository.audit.list({ projectId: project.id, limit: 500 });
    const studio = events.filter((event) => event.action.startsWith('studio.'));
    expect(studio.map((event) => event.action)).toEqual([
      'studio.started',
      'studio.section.edited',
      'studio.section.locked',
      'studio.section.unlocked',
      'studio.note.added',
      'studio.section.restored',
      'studio.submitted',
      'studio.changes.requested',
      'studio.submitted',
      'studio.approved',
      'studio.reopened',
      'studio.exported',
    ]);
    expect(studio.find((event) => event.action === 'studio.section.edited')?.detail).toMatchObject({
      section: 'S1',
      version: 2,
    });
    expect(studio.find((event) => event.action === 'studio.approved')?.detail).toMatchObject({
      state: 'approved',
      alsoEdited: true,
    });
    expect(JSON.stringify(events)).not.toContain(CANARY);
    expect(repository.audit.verify().ok).toBe(true);
  });

  it('writes the change and its audit entry together, so that a change that fails leaves neither', async () => {
    const { start, call, repository, project } = await harness();
    await start();
    const before = repository.audit.list({ projectId: project.id, limit: 500 }).length;
    vi.spyOn(repository.audit, 'record').mockImplementation(() => {
      throw new Error('the audit log is unavailable');
    });
    const failed = await call('PUT', '/sections/S1', {
      body: 'A change that cannot be recorded.',
      expectedVersion: 1,
      reason: null,
    });
    expect(failed.statusCode).toBe(500);
    vi.restoreAllMocks();
    expect(repository.studio.get(project.id)!.sections.find((s) => s.id === 'S1')!.version).toBe(1);
    expect(repository.audit.list({ projectId: project.id, limit: 500 })).toHaveLength(before);
  });
});

describe('a newer generated report', () => {
  async function stale() {
    const world = await harness();
    await world.start();
    await world.edit('S1', 'My text for the evidence chapter.');
    const report = generatedReport();
    world.repository.update(world.project.id, {
      report: {
        ...report,
        executiveSummary: 'A newer summary, from a report that was generated again.',
      },
    });
    return world;
  }

  it('is noticed, and the document is then read-only, though its text can still be taken out', async () => {
    const { view, edit, call, transition } = await stale();
    expect((await view()).stale).toBe(true);
    for (const response of [
      await edit('S2', 'A change to a stale document.'),
      await call('POST', '/sections/S1/notes', { text: 'A note on a stale document.' }),
      await call('PUT', '/sections/S1/lock', { locked: true }),
      await transition('submit'),
    ]) {
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('STUDIO_STALE');
    }
    const memo = await call('GET', '/export?format=memo');
    expect(memo.statusCode).toBe(200);
    expect(memo.body).toContain('has since been replaced');
    expect((await call('GET', '/export?format=markdown')).body).toContain(
      'has since been replaced',
    );
  });

  it('is started again only with the person’s say-so when they have worked on the old one, and keeps its text', async () => {
    const { call, view, sectionOf } = await stale();
    const refused = await call('POST', '', {});
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('CONFIRM_REQUIRED');
    expect((await view()).stale).toBe(true);
    const restarted = await call('POST', '', { confirm: true });
    expect(restarted.statusCode, restarted.body).toBe(201);
    const next = await view();
    expect(next.stale).toBe(false);
    expect(next.document).toMatchObject({ state: 'draft', revision: 3 });
    expect(sectionOf(next, 'summary').body).toBe(
      'A newer summary, from a report that was generated again.',
    );
    expect(sectionOf(next, 'S1')).toMatchObject({ version: 1, origin: 'generated' });
    expect(next.document!.archive).toHaveLength(1);
    expect(next.document!.archive[0]!.sections.find((s) => s.id === 'S1')!.body).toBe(
      'My text for the evidence chapter.',
    );
    expect(next.document!.decisions.map((d) => d.action)).toEqual(['started', 'restarted']);
  });

  it('is started again without a question when nobody worked on the old one', async () => {
    const { start, call, repository, project, view } = await harness();
    await start();
    repository.update(project.id, {
      report: { ...generatedReport(), title: 'Ferry report, generated again' },
    });
    expect((await call('POST', '', {})).statusCode).toBe(201);
    expect((await view()).document!.archive).toHaveLength(1);
  });

  it('is stale when the report is gone altogether, as when the stages run again', async () => {
    const { start, view, repository, project, edit } = await harness();
    await start();
    repository.update(project.id, { report: null });
    const current = await view();
    expect(current).toMatchObject({ stale: true, reportReady: false, report: null });
    expect((await edit('S1', 'Text for a document with no report.')).json().error.code).toBe(
      'STUDIO_STALE',
    );
  });
});
