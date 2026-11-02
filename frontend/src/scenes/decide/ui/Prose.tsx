import type { ReactNode } from 'react';

/** A quoted name or a number: the two things the eye looks for in a sentence of findings. */
const TOKEN =
  /(\u201c[^\u201d]{1,140}\u201d)|((?<![\w.\u2212-])[+\u2212]?\d[\d,]*(?:\.\d+)?(?![\w]))/gu;

/**
 * A sentence from the brief with its numbers and the names it quotes set a little stronger, so that a
 * long statement can be scanned. Every character is kept as it came; nothing is added or taken away,
 * and it is always text, never markup.
 */
export function Prose({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(
      match[1] ? (
        <span key={at} className="sw-decide-q">
          {match[1]}
        </span>
      ) : (
        <span key={at} className="sw-decide-n num">
          {match[0]}
        </span>
      ),
    );
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
