/**
 * What a page may say that Swarm does not keep: secrets that were published by mistake, and the contact
 * and identity details of private people. Evidence is about a subject, and a project is shared with
 * others, so these are masked before text becomes a document. The match is conservative on purpose: a
 * figure, a date or a reference number in a table must never be mistaken for one of these, so only
 * shapes that cannot be anything else are masked, and a few are checked (a check digit) before they are.
 */
export interface MaskCounts {
  secrets: number;
  emails: number;
  phones: number;
  cards: number;
  identifiers: number;
}

export const noMasks = (): MaskCounts => ({
  secrets: 0,
  emails: 0,
  phones: 0,
  cards: 0,
  identifiers: 0,
});

export interface Redacted {
  text: string;
  counts: MaskCounts;
}

const SECRET = '[secret removed]';

const PRIVATE_KEY =
  /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]{0,40}PRIVATE KEY-----|$)/gu;

/** Shapes of keys and tokens that providers issue: nothing else looks like these. */
const TOKENS: readonly RegExp[] = [
  /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[0-9A-Z]{16}\b/gu,
  /\bgh[pousr]_[A-Za-z0-9]{30,255}\b/gu,
  /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/gu,
  /\bsk-(?:proj-|live-|test-|ant-)?[A-Za-z0-9_-]{20,}\b/gu,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/gu,
  /\bAIza[0-9A-Za-z_-]{35}\b/gu,
  /\b[rs]k_(?:live|test)_[0-9A-Za-z]{16,}\b/gu,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/gu,
  /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:@/]{1,100}:[^\s@/]{1,200}@\S+/giu,
];

/** `password: value`, `api_key=value`: the name stays, the value goes. */
const NAMED_SECRET =
  /\b((?:password|passwd|pwd|secret|client[_-]?secret|api[_-]?key|apikey|access[_-]?key|secret[_-]?key|auth[_-]?token|access[_-]?token|token)\s*[:=]\s*)(["']?)[^\s"'<>,;]{8,}\2/giu;

const EMAIL = /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}\b/gu;

/** A number written for a telephone: labelled as one, or with a `+` and a country code. */
const LABELLED_PHONE =
  /\b((?:tel|telephone|phone|mobile|cell|fax|whatsapp)\b\.?\s*[:-]?\s*)\+?\(?\d[\d\s().-]{6,}\d/giu;
const INTERNATIONAL_PHONE =
  /(?<![\w.+])\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}(?!\d)/gu;

const GROUPED_CARD = /\b\d{4}(?:[ -]\d{4}){2,3}\b|\b\d{4}[ -]\d{6}[ -]\d{5}\b/gu;
const PREFIXED_CARD = /\b(?:4\d{12,18}|5[1-5]\d{14}|3[47]\d{13}|6011\d{12})\b/gu;
const SOCIAL_NUMBER = /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/gu;
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/gu;

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let at = digits.length - 1; at >= 0; at -= 1) {
    let digit = Number(digits[at]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return digits.length >= 13 && digits.length <= 19 && sum % 10 === 0;
}

function ibanOk(value: string): boolean {
  const text = value.replace(/ /gu, '');
  if (text.length < 15 || text.length > 34) return false;
  const moved = text.slice(4) + text.slice(0, 4);
  let remainder = 0;
  for (const character of moved) {
    const digits = /\d/u.test(character) ? character : String(character.charCodeAt(0) - 55);
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

const YEAR = /^(?:1[89]|20)\d\d$/u;

/** Years written in a row pass the check digit now and then, and a column of years is never a card. */
const years = (found: string): boolean => found.split(/[ -]/u).every((group) => YEAR.test(group));

/** Masks what should not be kept, and says how many of each. The words around it are left as they are. */
export function redact(input: string): Redacted {
  const counts = noMasks();
  let text = input;
  type Replacement = string | ((found: string, ...groups: string[]) => string);
  const replace = (
    pattern: RegExp,
    key: keyof MaskCounts,
    replacement: Replacement,
    accept: (found: string) => boolean = () => true,
  ): void => {
    text = text.replace(pattern, (found: string, ...rest: unknown[]) => {
      if (!accept(found)) return found;
      counts[key] += 1;
      // Groups come first among what the engine passes, then the position and the whole text.
      return typeof replacement === 'string'
        ? replacement
        : replacement(found, ...(rest as string[]));
    });
  };
  replace(PRIVATE_KEY, 'secrets', '[private key removed]');
  for (const token of TOKENS) replace(token, 'secrets', SECRET);
  replace(NAMED_SECRET, 'secrets', (_found, name, quote) => `${name}${quote}${SECRET}${quote}`);
  replace(EMAIL, 'emails', '[email removed]');
  replace(LABELLED_PHONE, 'phones', (_found, label) => `${label}[phone number removed]`);
  replace(INTERNATIONAL_PHONE, 'phones', '[phone number removed]');
  replace(
    GROUPED_CARD,
    'cards',
    '[card number removed]',
    (found) => !years(found) && luhn(found.replace(/[ -]/gu, '')),
  );
  replace(PREFIXED_CARD, 'cards', '[card number removed]', luhn);
  replace(SOCIAL_NUMBER, 'identifiers', '[id number removed]');
  replace(IBAN, 'identifiers', '[account number removed]', ibanOk);
  return { text, counts };
}

const NOUNS: readonly [keyof MaskCounts, string, string][] = [
  ['secrets', 'secret', 'secrets'],
  ['emails', 'email address', 'email addresses'],
  ['phones', 'phone number', 'phone numbers'],
  ['cards', 'card number', 'card numbers'],
  ['identifiers', 'identity or account number', 'identity or account numbers'],
];

export function addMasks(total: MaskCounts, more: MaskCounts): void {
  for (const key of Object.keys(total) as (keyof MaskCounts)[]) total[key] += more[key];
}

/** A sentence for a person, from the counts alone: it holds nothing of what was masked. Empty when nothing was. */
export function describeMasks(counts: MaskCounts): string {
  const parts = NOUNS.filter(([key]) => counts[key] > 0).map(
    ([key, one, many]) => `${counts[key]} ${counts[key] === 1 ? one : many}`,
  );
  return parts.length === 0 ? '' : `Masked before the page was kept: ${parts.join(', ')}.`;
}
