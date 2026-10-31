import { afterEach, describe, expect, it, vi } from 'vitest';
import { viewFixture } from '../test/critics';
import { REVIEW_CHANGED_WHILE_WRITING, sendAnswer } from './useCritiques';

// What a response to the review sends, and what the page makes of each answer. The server's own
// behaviour is tested in backend/test/lineage.test.ts.

interface Sent {
  path: string;
  body: unknown;
}

function serve(body: unknown, status = 200): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    sent.push({ path, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return sent;
}

afterEach(() => vi.unstubAllGlobals());

const ANSWER = { text: 'We accept this.', status: 'accepted' } as const;

describe('answering a criticism', () => {
  it('says which review it is about: the revision of the one the person is looking at', async () => {
    const view = viewFixture({ revision: 4 });
    const sent = serve(view);
    const outcome = await sendAnswer('p-1', 'methodology-rules-only', ANSWER, 3);
    expect(outcome).toEqual({ saved: true, view });
    expect(sent[0]?.path).toBe('/api/projects/p-1/critiques/methodology-rules-only/response');
    expect(sent[0]?.body).toEqual({ ...ANSWER, expectedRevision: 3 });
  });

  it('says in the page’s words that the review changed, and that it has to be read again', async () => {
    serve(
      {
        error: {
          code: 'CRITIQUES_CHANGED',
          message: 'This review changed while you were reading it. Reload the review.',
        },
      },
      409,
    );
    expect(await sendAnswer('p-1', 'x', ANSWER, 3)).toEqual({
      saved: false,
      moved: true,
      message: REVIEW_CHANGED_WHILE_WRITING,
    });
    expect(REVIEW_CHANGED_WHILE_WRITING).toContain('What you wrote is still here');
  });

  it('says in the server’s own words why any other refusal happened, and does not read the review again', async () => {
    serve(
      {
        error: { code: 'FORBIDDEN', message: 'Your role on this experiment does not allow this.' },
      },
      403,
    );
    expect(await sendAnswer('p-1', 'x', ANSWER, 3)).toEqual({
      saved: false,
      moved: false,
      message: 'Your role on this experiment does not allow this.',
    });
  });
});
