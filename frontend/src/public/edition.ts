import { EDITION_META_NAME } from '../../../shared/public';
import { setPublicEdition } from './runtime';

/**
 * Whether the server marked this page as the public edition. It is read from the page itself and nowhere else, so the
 * answer is there before anything is drawn and no request is needed to find it.
 */
export function isPublicEdition(doc: Document = document): boolean {
  const tag = doc.querySelector(`meta[name="${EDITION_META_NAME}"]`);
  return tag?.getAttribute('content') === 'public';
}

/** Run once at start-up: the API client takes part in the public edition only if the page says it is one. */
export function bootEdition(doc: Document = document): boolean {
  const on = isPublicEdition(doc);
  setPublicEdition(on);
  return on;
}
