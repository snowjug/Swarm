import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { ArrowLeft, ArrowUpRight, FileText, Search } from 'lucide-react';
import type { EvidenceChunk, EvidenceMatch } from '../../../../shared/types';
import { api, errorMessage, isAbort } from '../../api';
import {
  Button,
  ChipButton,
  EmptyState,
  Disclosure,
  Input,
  Notice,
  Orbit,
  Sheet,
  SheetClose,
  SheetContent,
  Skeleton,
} from '../../design/ui';
import { dateTime } from '../../lib/format';
import { sourceLink } from '../../lib/format';
import { splitAtQuote } from '../../lib/ledger';
import { ClaimSheetContent } from './ClaimSheet';
import { useGroundActions, useGroundData, type SheetTarget } from './context';
import { vars } from './css';
import { describeSearch, documentColour, figure, plural } from './model';
import {
  excerptAround,
  findMark,
  findPassage,
  locateQuote,
  rangeText,
  segmentDocument,
} from './passages';
import { SourceTag } from './SourceTag';
import { focusSheet } from './sheetFocus';
import './sheets.css';

type Stack = SheetTarget[];

interface Navigation {
  canGoBack: boolean;
  back: () => void;
  push: (target: SheetTarget) => void;
  close: () => void;
}

function Eyebrow({ nav, children }: { nav: Navigation; children: string }) {
  if (!nav.canGoBack) return <>{children}</>;
  return (
    <button type="button" className="sw-ground-sheet__back" onClick={nav.back}>
      <ArrowLeft size={14} aria-hidden="true" />
      Back
    </button>
  );
}

// ---- A document, read ---------------------------------------------------------------------------

function DocumentView({
  target,
  nav,
}: {
  target: Extract<SheetTarget, { kind: 'document' }>;
  nav: Navigation;
}) {
  const { documents, passages, project, mode } = useGroundData();
  const doc = documents.find((item) => item.id === target.id);
  const source = project.documents.find((item) => item.id === target.id);
  const own = useMemo(
    () => passages.index?.byDocument.get(target.id) ?? [],
    [passages.index, target.id],
  );
  const [focused, setFocused] = useState<string | null>(target.passageId ?? null);
  const body = useRef<HTMLDivElement>(null);

  const focusedPassage = focused ? (own.find((passage) => passage.id === focused) ?? null) : null;
  const quote = useMemo(
    () =>
      source
        ? locateQuote(source.content, focusedPassage ?? own[0] ?? null, target.quote ?? null)
        : null,
    [source, focusedPassage, own, target.quote],
  );
  const segments = useMemo(
    () => (source ? segmentDocument(source.content, own, quote) : []),
    [source, own, quote],
  );

  useEffect(() => {
    const root = body.current;
    if (!root) return;
    findMark(root, quote !== null, focused)?.scrollIntoView({ block: 'center', behavior: 'auto' });
  }, [focused, quote]);

  if (!doc || !source) {
    return (
      <SheetContent
        className="sw-ground-sheet"
        title="Not in this project"
        eyebrow={<Eyebrow nav={nav}>Document</Eyebrow>}
        description={`No document named ${target.id} is recorded here.`}
        width="lg"
        onOpenAutoFocus={focusSheet}
      >
        <EmptyState icon={<FileText size={22} aria-hidden="true" />} title="Nothing to read">
          The record does not hold this document.
        </EmptyState>
      </SheetContent>
    );
  }

  const link = sourceLink(doc.address);
  return (
    <SheetContent
      className="sw-ground-sheet"
      width="xl"
      onOpenAutoFocus={focusSheet}
      eyebrow={<Eyebrow nav={nav}>{`Document · ${doc.id}`}</Eyebrow>}
      title={doc.name}
      description={`${plural(doc.characters, 'character')}${doc.pages ? ` · ${plural(doc.pages, 'page')}` : ''}${
        passages.index ? ` · ${plural(own.length, 'passage')}` : ''
      }`}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => nav.push({ kind: 'browse' })}
            icon={<Search size={16} aria-hidden="true" />}
          >
            Search passages
          </Button>
          <SheetClose asChild>
            <Button variant="primary">Done</Button>
          </SheetClose>
        </>
      }
    >
      <div className="sw-ground-doc" style={vars({ '--doc': documentColour(doc.index) })}>
        <div className="sw-ground-doc__origin">
          <SourceTag doc={doc} />
          {doc.synthetic && (
            <span className="sw-caption">Illustrative text, not real information.</span>
          )}
          {doc.kind === 'url' && (
            <span className="sw-caption">
              {doc.fetchedByServer ? 'Retrieved by Swarm' : 'Web page'}
              {doc.retrievedAt ? ` on ${dateTime(doc.retrievedAt)}` : ''}. Retrieved, not verified.
            </span>
          )}
          {link && (
            <a
              className="sw-ground-doc__link"
              href={link}
              target="_blank"
              rel="noopener noreferrer"
            >
              {doc.host ?? 'Open page'}
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          )}
        </div>

        {own.length > 0 && (
          <ul
            className="sw-ground-doc__passages"
            role="list"
            aria-label="Passages in this document"
          >
            {own.map((passage) => (
              <li key={passage.id}>
                <ChipButton
                  size="sm"
                  pressed={focused === passage.id}
                  onClick={() => setFocused(focused === passage.id ? null : passage.id)}
                  title={rangeText(passage)}
                >
                  {passage.id}
                </ChipButton>
              </li>
            ))}
          </ul>
        )}

        <div className="sw-ground-text" ref={body} data-focus={focused ?? undefined} lang="en">
          {segments.map((segment) => {
            const starts = own
              .filter((passage) => passage.start === segment.start)
              .map((passage) => passage.id);
            const lit = focused !== null && segment.passageIds.includes(focused);
            return (
              <span
                key={segment.start}
                className="sw-ground-text__seg"
                data-passages={segment.passageIds.length}
                data-start={starts.join(' ') || undefined}
                data-lit={lit || undefined}
                data-quoted={segment.quoted || undefined}
              >
                {starts.length > 0 && (
                  <span className="sw-ground-text__mark" aria-hidden="true">
                    {starts.join(' ')}
                  </span>
                )}
                {segment.quoted ? <mark>{segment.text}</mark> : segment.text}
              </span>
            );
          })}
        </div>
        {doc.pages !== null && (
          <p className="sw-caption">Text taken from the file. Scanned images are not read.</p>
        )}

        {(mode === 'advanced' || doc.title || doc.license || doc.asOf || doc.sha256) && (
          <Disclosure summary="Details">
            <dl className="sw-ground-facts">
              {doc.title && (
                <div>
                  <dt>Title</dt>
                  <dd>{doc.title}</dd>
                </div>
              )}
              {doc.license && (
                <div>
                  <dt>Licence</dt>
                  <dd>{doc.license}</dd>
                </div>
              )}
              {doc.asOf && (
                <div>
                  <dt>As of</dt>
                  <dd>{doc.asOf}</dd>
                </div>
              )}
              {doc.contentType && (
                <div>
                  <dt>Type</dt>
                  <dd>{doc.contentType}</dd>
                </div>
              )}
              {doc.sha256 && (
                <div>
                  <dt>SHA-256</dt>
                  <dd className="sw-mono">{doc.sha256}</dd>
                </div>
              )}
              {mode === 'advanced' && (
                <div>
                  <dt>Id</dt>
                  <dd className="sw-mono">{doc.id}</dd>
                </div>
              )}
            </dl>
          </Disclosure>
        )}
      </div>
    </SheetContent>
  );
}

// ---- One passage --------------------------------------------------------------------------------

function UsedBy({ passageId, nav }: { passageId: string; nav: Navigation }) {
  const { graph, ledger } = useGroundData();
  const actions = useGroundActions();
  const nodes = graph?.nodes.filter((node) => node.sourceIds.includes(passageId)) ?? [];
  const conflicts =
    ledger.ledger?.contradictions.filter(
      (conflict) => conflict.left.passageId === passageId || conflict.right.passageId === passageId,
    ) ?? [];
  if (nodes.length === 0 && conflicts.length === 0) return null;
  return (
    <section className="sw-ground-used" aria-label="Where it is used">
      <h3 className="sw-eyebrow">Used by</h3>
      <ul role="list">
        {nodes.map((node) => (
          <li key={node.id}>
            <ChipButton
              size="sm"
              onClick={() => {
                nav.close();
                actions.selectNode(node.id);
                actions.goTo('graph');
              }}
            >
              {node.label}
            </ChipButton>
          </li>
        ))}
        {conflicts.map((conflict) => (
          <li key={conflict.id}>
            <ChipButton
              size="sm"
              tone="caution"
              onClick={() => {
                nav.close();
                actions.showConflict(conflict.id);
              }}
            >
              Conflict {conflict.id}
            </ChipButton>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PassageView({
  target,
  nav,
}: {
  target: Extract<SheetTarget, { kind: 'passage' }>;
  nav: Navigation;
}) {
  const { passages, documents, mode } = useGroundData();
  const passage = findPassage(passages.index, target.id);
  if (!passage) {
    return (
      <SheetContent
        className="sw-ground-sheet"
        width="lg"
        onOpenAutoFocus={focusSheet}
        eyebrow={<Eyebrow nav={nav}>Passage</Eyebrow>}
        title={passages.loading ? 'Reading passages' : `${target.id} is not here`}
        description={
          passages.loading
            ? 'One moment.'
            : 'No passage with that name is recorded for this project.'
        }
      >
        {passages.loading ? (
          <div className="sw-ground-skeleton" aria-hidden="true">
            <Skeleton height="1rem" width="40%" />
            <Skeleton height="6rem" />
          </div>
        ) : (
          <EmptyState
            icon={<FileText size={22} aria-hidden="true" />}
            title="Nothing to show"
            action={
              <div className="sw-ground-empty-actions">
                {passages.error && (
                  <Button size="sm" variant="glass" onClick={passages.reload}>
                    Retry
                  </Button>
                )}
                <Button size="sm" variant="glass" onClick={() => nav.push({ kind: 'browse' })}>
                  Browse passages
                </Button>
              </div>
            }
          >
            {passages.error ?? 'It may be from an older record, or the id may be mistyped.'}
          </EmptyState>
        )}
      </SheetContent>
    );
  }
  const doc = documents.find((item) => item.id === passage.documentId);
  const split = splitAtQuote(passage.text, target.quote ?? null);
  return (
    <SheetContent
      className="sw-ground-sheet"
      width="lg"
      onOpenAutoFocus={focusSheet}
      eyebrow={<Eyebrow nav={nav}>{`Passage · ${passage.documentName}`}</Eyebrow>}
      title={passage.id}
      description={rangeText(passage)}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() =>
              nav.push({
                kind: 'document',
                id: passage.documentId,
                passageId: passage.id,
                quote: target.quote,
              })
            }
            icon={<FileText size={16} aria-hidden="true" />}
          >
            Read in the document
          </Button>
          <SheetClose asChild>
            <Button variant="primary">Done</Button>
          </SheetClose>
        </>
      }
    >
      <div className="sw-ground-doc" style={vars({ '--doc': documentColour(doc?.index ?? 0) })}>
        <div className="sw-ground-doc__origin">{doc && <SourceTag doc={doc} />}</div>
        <blockquote className="sw-ground-text sw-ground-text--passage">
          {split ? (
            <>
              {split.before}
              <mark>{split.quote}</mark>
              {split.after}
            </>
          ) : (
            passage.text
          )}
        </blockquote>
        {target.quote && (
          <p className="sw-caption">
            {split
              ? 'The marked words are in it exactly as written.'
              : 'The quoted words were not found in this passage.'}
          </p>
        )}
        <UsedBy passageId={passage.id} nav={nav} />
        {mode === 'advanced' && (
          <Disclosure summary="Details">
            <dl className="sw-ground-facts">
              {passage.parserVersion && (
                <div>
                  <dt>Cut by</dt>
                  <dd>{passage.parserVersion}</dd>
                </div>
              )}
              {passage.extractedAt && (
                <div>
                  <dt>Cut on</dt>
                  <dd>{dateTime(passage.extractedAt)}</dd>
                </div>
              )}
              {passage.reviewStatus && (
                <div>
                  <dt>Review</dt>
                  <dd>{passage.reviewStatus}</dd>
                </div>
              )}
              {passage.contentHash && (
                <div>
                  <dt>SHA-256</dt>
                  <dd className="sw-mono">{passage.contentHash}</dd>
                </div>
              )}
            </dl>
          </Disclosure>
        )}
      </div>
    </SheetContent>
  );
}

// ---- Looking through the passages --------------------------------------------------------------

function useSearch(projectId: string, query: string) {
  const [state, setState] = useState<{
    matches: EvidenceMatch[];
    loading: boolean;
    error: string | null;
  }>({
    matches: [],
    loading: Boolean(query),
    error: null,
  });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!query) {
      setState({ matches: [], loading: false, error: null });
      return undefined;
    }
    const controller = new AbortController();
    setState((old) => ({ ...old, loading: true, error: null }));
    void api.evidence(projectId, query, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted)
          setState({ matches: result.matches, loading: false, error: null });
      },
      (failure: unknown) => {
        if (controller.signal.aborted || isAbort(failure)) return;
        setState({ matches: [], loading: false, error: errorMessage(failure) });
      },
    );
    return () => controller.abort();
  }, [projectId, query, revision]);
  return { ...state, retry: () => setRevision((value) => value + 1) };
}

function PassageRow({
  passage,
  onOpen,
  needle,
}: {
  passage: EvidenceChunk;
  onOpen: () => void;
  needle: string | null;
}) {
  const { documents } = useGroundData();
  const doc = documents.find((item) => item.id === passage.documentId);
  return (
    <button
      type="button"
      className="sw-ground-hit"
      style={vars({ '--doc': documentColour(doc?.index ?? 0) })}
      onClick={onOpen}
    >
      <span className="sw-ground-hit__id num">{passage.id}</span>
      <span className="sw-ground-hit__body">
        <span className="sw-ground-hit__doc">{passage.documentName}</span>
        <span className="sw-ground-hit__text">{excerptAround(passage.text, needle, 120)}</span>
      </span>
    </button>
  );
}

function BrowseView({
  target,
  nav,
}: {
  target: Extract<SheetTarget, { kind: 'browse' }>;
  nav: Navigation;
}) {
  const { project, passages } = useGroundData();
  const [draft, setDraft] = useState(target.query ?? '');
  const [query, setQuery] = useState((target.query ?? '').trim());
  const search = useSearch(project.id, query);
  const all = passages.index?.all ?? [];
  const results: EvidenceChunk[] = query ? search.matches : all;
  return (
    <SheetContent
      className="sw-ground-sheet"
      width="lg"
      onOpenAutoFocus={focusSheet}
      eyebrow={<Eyebrow nav={nav}>Passages</Eyebrow>}
      title="Search the sources"
      description={
        passages.index
          ? `${plural(all.length, 'passage')}, numbered S1 to S${figure(all.length)}.`
          : undefined
      }
      footer={
        <SheetClose asChild>
          <Button variant="primary">Done</Button>
        </SheetClose>
      }
    >
      <form
        className="sw-ground-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(draft.trim());
        }}
      >
        <Input
          type="search"
          value={draft}
          maxLength={1000}
          aria-label="Search the passages"
          placeholder="A word, a figure, or S3"
          autoComplete="off"
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button
          type="submit"
          variant="glass"
          icon={<Search size={16} aria-hidden="true" />}
          disabled={search.loading}
        >
          Search
        </Button>
      </form>
      {query && (
        <div className="sw-ground-search__what">
          <p className="sw-caption" role="status">
            {search.loading ? 'Searching…' : describeSearch(results.length, query)}
          </p>
          <button
            type="button"
            className="sw-ground-search__clear"
            onClick={() => {
              setDraft('');
              setQuery('');
            }}
          >
            Show all
          </button>
        </div>
      )}
      {search.loading && (
        <div className="sw-ground-search__busy">
          <Orbit size={20} label="Searching" />
        </div>
      )}
      {search.error && (
        <Notice
          tone="error"
          title="The search failed"
          action={
            <Button size="sm" variant="glass" onClick={search.retry}>
              Retry
            </Button>
          }
        >
          {search.error}
        </Notice>
      )}
      {passages.loading && !query && (
        <div className="sw-ground-skeleton" aria-hidden="true">
          <Skeleton height="3.2rem" />
          <Skeleton height="3.2rem" />
          <Skeleton height="3.2rem" />
        </div>
      )}
      {!search.loading && !search.error && results.length === 0 && !passages.loading && (
        <EmptyState
          icon={<Search size={22} aria-hidden="true" />}
          title={query ? 'Nothing matched' : 'No passages'}
        >
          {query
            ? 'Try another word, or leave it empty to see them all.'
            : 'The sources have not been cut into passages.'}
        </EmptyState>
      )}
      <ul className="sw-ground-hits" role="list">
        {results.map((passage) => (
          <li key={passage.id}>
            <PassageRow
              passage={passage}
              needle={query || null}
              onOpen={() => nav.push({ kind: 'passage', id: passage.id })}
            />
          </li>
        ))}
      </ul>
    </SheetContent>
  );
}

/**
 * The one sheet that opens from the side (from the bottom on a phone) to read what the evidence says: a
 * document with its passages marked, one passage with the words that were quoted, a search through them all,
 * or one statement with everything behind it. Each opens from where the person was, and Back goes there.
 */
export function EvidenceSheet({
  stack,
  onStack,
}: {
  stack: Stack;
  onStack: Dispatch<SetStateAction<Stack>>;
}) {
  const top = stack.at(-1) ?? null;
  const shown = useRef<SheetTarget | null>(null);
  if (top) shown.current = top;
  const target = top ?? shown.current;
  // Moving from one thing to another inside the open sheet (a passage from a document, back) puts the focus on
  // the sheet again, so that a screen reader is told what it now shows and the keyboard is not left on nothing.
  const depth = stack.length;
  const key = top ? `${top.kind}:${'id' in top ? top.id : ''}` : '';
  const previous = useRef({ depth, key });
  useEffect(() => {
    if (depth > 0 && previous.current.depth > 0 && previous.current.key !== key) {
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>('.sw-ground-sheet[role="dialog"]')
          ?.focus({ preventScroll: true }),
      );
    }
    previous.current = { depth, key };
  }, [depth, key]);
  const nav: Navigation = {
    canGoBack: stack.length > 1,
    back: () => onStack((old) => old.slice(0, -1)),
    push: (next) => onStack((old) => [...old, next].slice(-6)),
    close: () => onStack([]),
  };
  return (
    <Sheet open={top !== null} onOpenChange={(open) => !open && onStack([])}>
      {target?.kind === 'document' && <DocumentView target={target} nav={nav} />}
      {target?.kind === 'passage' && <PassageView target={target} nav={nav} />}
      {target?.kind === 'browse' && <BrowseView target={target} nav={nav} />}
      {target?.kind === 'claim' && <ClaimSheetContent claimId={target.id} />}
    </Sheet>
  );
}
