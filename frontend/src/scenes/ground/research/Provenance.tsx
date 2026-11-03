import { ArrowUpRight, ScrollText } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ResearchSource } from '../../../../../shared/research';
import { Button, Popover, PopoverContent, PopoverTrigger } from '../../../design/ui';
import { plural } from '../model';
import { formatBytes, formatMoment, linkOf, sourceTitle } from './model';
import { EXTRACTION_SENTENCE, FOUND_BY_SENTENCE, ROBOTS_SENTENCE } from './words';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sw-research-prov__row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * Where a page came from and how it was read, said as the run recorded it: the address asked for and the one it ended
 * at, when it was fetched, a hash of the text that was read, what the site's robots.txt said, how the text was taken
 * from the page, and what a reader should know before relying on it. All of it is text; none of it is a link but the
 * one that opens the page itself, and that only for a web address.
 */
export function Provenance({ source }: { source: ResearchSource }) {
  const title = sourceTitle(source);
  const link = linkOf(source);
  const final = source.finalUrl && source.finalUrl !== source.requestedUrl ? source.finalUrl : null;
  const canonical =
    source.canonicalUrl && source.canonicalUrl !== (source.finalUrl ?? source.requestedUrl)
      ? source.canonicalUrl
      : null;
  const received = [
    source.httpStatus ? `HTTP ${source.httpStatus}` : null,
    source.contentType,
    source.bytes > 0 ? formatBytes(source.bytes) : null,
  ].filter(Boolean);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          icon={<ScrollText size={15} aria-hidden="true" />}
          aria-label={`Provenance: ${title}`}
          className="sw-research-page__prov"
        >
          Provenance
        </Button>
      </PopoverTrigger>
      <PopoverContent width="26rem" align="end" aria-label={`Provenance of ${title}`}>
        <div className="sw-research-prov">
          <h3 className="sw-research-prov__title">{title}</h3>
          <dl className="sw-research-prov__list">
            {source.requestedUrl && <Row label="Address asked for">{source.requestedUrl}</Row>}
            {final && <Row label="Address it ended at">{final}</Row>}
            {canonical && <Row label="Address it names for itself">{canonical}</Row>}
            {source.fetchedAt && (
              <Row label="Fetched">
                <time dateTime={source.fetchedAt}>{formatMoment(source.fetchedAt)}</time>
              </Row>
            )}
            {received.length > 0 && <Row label="Received">{received.join(' · ')}</Row>}
            {source.contentHash && (
              <Row label="Content hash">
                <span className="sw-research-prov__hash">SHA-256 {source.contentHash}</span>
              </Row>
            )}
            <Row label="robots.txt">{ROBOTS_SENTENCE[source.robots]}</Row>
            {source.extractionMethod && (
              <Row label="Text taken as">{EXTRACTION_SENTENCE[source.extractionMethod]}</Row>
            )}
            <Row label="Found through">
              {FOUND_BY_SENTENCE[source.discoveredBy]}
              {source.depth > 0 ? ` ${plural(source.depth, 'link')} from the start.` : ''}
            </Row>
            {source.parentUrl && <Row label="Linked from">{source.parentUrl}</Row>}
            {source.author && <Row label="Author it names">{source.author}</Row>}
            {source.relevance && <Row label="Why it was read">{source.relevance}</Row>}
            {source.passageCount > 0 && (
              <Row label="Passages">{plural(source.passageCount, 'passage')}</Row>
            )}
          </dl>
          {source.injectionFlagged && (
            <p className="sw-research-prov__note">
              Its text matched a pattern for instructions to an AI system. It is labelled, and never
              obeyed.
            </p>
          )}
          {source.warnings.length > 0 && (
            <div className="sw-research-prov__warnings">
              <h4 className="sw-research-prov__sub">Before relying on it</h4>
              <ul role="list">
                {source.warnings.map((warning, index) => (
                  <li key={`${index}:${warning}`}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
          {link && (
            <a
              className="sw-research-prov__open"
              href={link}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open the page
              <ArrowUpRight size={14} aria-hidden="true" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
