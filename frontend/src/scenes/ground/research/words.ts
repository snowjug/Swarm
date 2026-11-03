import type {
  AuthorityEstimate,
  FetchErrorClass,
  QuarantineReason,
  ResearchSource,
  RobotsDecision,
  SourceOutcome,
} from '../../../../../shared/research';

// What a page says about the research, in plain words. Every enumeration of the contract has its sentence here, so
// that a value the server sends is never shown as the name it has in code. None of these says that a page is right:
// they say what was done with it, and why.

export const OUTCOME_LABEL: Record<SourceOutcome, string> = {
  used: 'Used',
  read: 'Read',
  quarantined: 'Quarantined',
  blocked: 'Blocked',
  failed: 'Failed',
  duplicate: 'Duplicate',
  skipped: 'Skipped',
};

/** What became of the page, in a sentence, for a page that has no reason of its own to give. */
export const OUTCOME_SENTENCE: Record<SourceOutcome, string> = {
  used: 'Used as a source for the exploration.',
  read: 'Read, and not used as a source.',
  quarantined: 'Kept out of the evidence.',
  blocked: 'Swarm did not read it.',
  failed: 'It could not be read.',
  duplicate: 'It repeats a page that was already read.',
  skipped: 'It was not read.',
};

export const QUARANTINE_SENTENCE: Record<QuarantineReason, string> = {
  empty: 'The page had no readable text.',
  'login-page': 'It asks for a sign-in, so there was nothing to read.',
  'consent-wall': 'It is a cookie or consent screen, not the page itself.',
  paywall: 'It is behind a paywall.',
  'error-page': 'It is an error page.',
  malformed: 'Its markup could not be read reliably.',
  oversized: 'It is larger than the size limit.',
  'unsupported-type': 'Its file type is not one Swarm reads.',
  'binary-as-text': 'It looks like a binary file, not text.',
  'prompt-injection':
    'Its text tries to give instructions to an AI system. It is listed here and not read as evidence.',
};

export const FAILURE_SENTENCE: Record<FetchErrorClass, string> = {
  'invalid-url': 'The address is not valid.',
  'blocked-address': 'The address is on a private or local network, which Swarm never reads.',
  'blocked-scheme': 'The address uses a scheme that Swarm does not read.',
  'blocked-port': 'The address uses a port that Swarm does not read.',
  'robots-disallowed': 'The site’s robots.txt asks not to be read, so Swarm did not read it.',
  dns: 'The site’s name could not be found.',
  connect: 'The site could not be reached.',
  timeout: 'The site took too long to answer.',
  tls: 'The secure connection could not be made.',
  'http-status': 'The site answered with an error.',
  'redirect-refused': 'It redirects somewhere that Swarm does not follow.',
  'too-large': 'The page is larger than the size limit.',
  'unsupported-type': 'Its file type is not one Swarm reads.',
  'decompression-limit': 'It expands to more than the size limit.',
  'circuit-open': 'The site kept failing, so Swarm stopped asking it.',
  cancelled: 'The request was stopped.',
  unknown: 'The request failed.',
};

export const ROBOTS_SENTENCE: Record<RobotsDecision, string> = {
  allowed: 'The site’s robots.txt allows it.',
  absent: 'The site has no robots.txt.',
  disallowed: 'The site’s robots.txt asks not to be read.',
  skipped: 'Not checked.',
};

export const EXTRACTION_SENTENCE: Record<
  NonNullable<ResearchSource['extractionMethod']>,
  string
> = {
  'html-main': 'The main text of the page.',
  'html-page': 'The text of the whole page.',
  'html-all': 'All of the text found in the page.',
  'plain-text': 'Plain text.',
  json: 'A JSON file, read as text.',
  csv: 'A table, read as text.',
  pdf: 'Text taken from a PDF.',
};

export const FOUND_BY_SENTENCE: Record<ResearchSource['discoveredBy'], string> = {
  'user-url': 'The page you named.',
  'user-domain': 'The site you named.',
  link: 'A link on a page it had read.',
  sitemap: 'The site’s sitemap.',
  search: 'A search.',
  'user-added': 'Added by you.',
};

export const AUTHORITY_LABEL: Record<AuthorityEstimate, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  unknown: 'Unknown',
};

/** How many of three marks an estimate fills. */
export const AUTHORITY_STEPS: Record<AuthorityEstimate, number> = {
  high: 3,
  medium: 2,
  low: 1,
  unknown: 0,
};

export const AUTHORITY_NOTE =
  'An estimate from the kind of site it is. It says nothing about whether a page is right.';

export const ASSESSMENT_LABEL = {
  supported: 'Passages support it',
  contested: 'Passages both support and oppose it',
  opposed: 'Passages oppose it',
  unassessed: 'Nothing read bears on it yet',
} as const;
