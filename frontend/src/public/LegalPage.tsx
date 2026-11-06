import { useEffect, useState } from 'react';
import { Button, Notice, Skeleton } from '../design/ui';
import type { LegalDocument, LegalText, PublicSession } from '../../../shared/public';
import { legalBlocks } from './legalText';
import { SERVICE_UNREACHABLE } from './problems';
import { fetchLegal } from './publicApi';
import { PublicFrame } from './PublicFrame';
import { useDocumentTitle } from './useDocumentTitle';

type State = { phase: 'loading' } | { phase: 'ready'; text: LegalText } | { phase: 'failed' };

const FALLBACK_TITLE: Record<LegalDocument, string> = {
  terms: 'Terms of use',
  privacy: 'Privacy notice',
};

/** The owner's text, as text. It is read into headings, lists and paragraphs, and every one of them is a text node. */
function LegalBody({ title, text }: { title: string; text: string }) {
  const blocks = legalBlocks(text);
  // A first heading that only repeats the title of the page is not shown twice.
  const first = blocks[0];
  const shown =
    first?.kind === 'heading' && first.text.trim().toLowerCase() === title.trim().toLowerCase()
      ? blocks.slice(1)
      : blocks;
  return (
    <div className="sw-pub-legal__body">
      {shown.map((block, index) => {
        if (block.kind === 'heading') {
          const Heading = block.level === 2 ? 'h2' : 'h3';
          return (
            <Heading key={index} className="sw-heading">
              {block.text}
            </Heading>
          );
        }
        if (block.kind === 'list') {
          return (
            <ul key={index}>
              {block.items.map((item, at) => (
                <li key={at}>{item}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index} className="sw-pub-legal__text">
            {block.text}
          </p>
        );
      })}
    </div>
  );
}

/** The terms or the privacy notice, fetched from the server and shown as text. */
export function LegalPage({ doc, session }: { doc: LegalDocument; session: PublicSession | null }) {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ phase: 'loading' });
    void fetchLegal(doc).then((reply) => {
      if (cancelled) return;
      setState(
        reply.ok && typeof reply.data?.text === 'string'
          ? { phase: 'ready', text: reply.data }
          : { phase: 'failed' },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [doc, attempt]);

  const title =
    state.phase === 'ready' ? state.text.title || FALLBACK_TITLE[doc] : FALLBACK_TITLE[doc];
  useDocumentTitle(`${title} | Swarm`);
  return (
    <PublicFrame session={session}>
      <article className="sw-pub-legal" data-testid="legal-page" data-doc={doc}>
        <h1 className="sw-title">{title}</h1>
        {state.phase === 'loading' && (
          <div className="sw-pub-status__wait" aria-busy="true">
            <span className="sr-only" role="status">
              Reading the text
            </span>
            <Skeleton height="1.2rem" width="90%" />
            <Skeleton height="1.2rem" width="80%" />
            <Skeleton height="1.2rem" width="85%" />
          </div>
        )}
        {state.phase === 'failed' && (
          <Notice
            tone="error"
            title={SERVICE_UNREACHABLE}
            action={
              <Button size="sm" variant="glass" onClick={() => setAttempt((count) => count + 1)}>
                Try again
              </Button>
            }
          >
            The text could not be read. Check your connection, then try again.
          </Notice>
        )}
        {state.phase === 'ready' && (
          <>
            {!state.text.reviewed && (
              <div className="sw-pub-legal__banner" data-testid="legal-unreviewed">
                <Notice tone="caution" title="NOT YET REVIEWED by the site owner">
                  This text is a placeholder. Do not rely on it.
                </Notice>
              </div>
            )}
            <LegalBody title={title} text={state.text.text} />
          </>
        )}
      </article>
    </PublicFrame>
  );
}
