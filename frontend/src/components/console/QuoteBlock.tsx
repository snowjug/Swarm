import type { ReactNode } from 'react';

/** An excerpt with a visible label saying where it came from. */
export function QuoteBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="quote-block">
      <figcaption>{label}</figcaption>
      <blockquote>{children}</blockquote>
    </figure>
  );
}
