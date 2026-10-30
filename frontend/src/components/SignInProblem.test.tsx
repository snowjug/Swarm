import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SignInProblem } from './SignInProblem';
import { signInProblem } from '../lib/signIn';

describe('the sign-in problem screen', () => {
  it('reads only the two problems the server can send back, from the address', () => {
    expect(signInProblem('?signin=failed')).toBe('failed');
    expect(signInProblem('?project=x&signin=norole')).toBe('norole');
    for (const search of [
      '',
      '?signin=',
      '?signin=ok',
      '?signin=FAILED',
      '?signin=failed%00',
      '?x=1',
    ]) {
      expect(signInProblem(search), search).toBeNull();
    }
  });

  it('says what happened and offers one way forward, with exactly one page heading', () => {
    for (const kind of ['failed', 'norole'] as const) {
      const html = renderToStaticMarkup(<SignInProblem kind={kind} />);
      expect(html.match(/<h1[ >]/gu)).toHaveLength(1);
      expect(html).toContain('role="alert"');
      // The only way forward is the server's own sign-in address, with no return address to leak or loop.
      expect(html).toContain('href="/auth/login"');
      expect(html).not.toContain('returnTo');
    }
    expect(renderToStaticMarkup(<SignInProblem kind="norole" />)).toContain('no Swarm role');
    expect(renderToStaticMarkup(<SignInProblem kind="failed" />)).toContain('did not complete');
  });
});
