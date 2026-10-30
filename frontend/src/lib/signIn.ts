export type SignInProblemKind = 'failed' | 'norole';

/** The problem Microsoft sign-in left on the address, if any. Anything else is not a problem to show. */
export function signInProblem(search: string): SignInProblemKind | null {
  const value = new URLSearchParams(search).get('signin');
  return value === 'failed' || value === 'norole' ? value : null;
}
