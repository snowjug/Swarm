import { createHash } from 'node:crypto';

/** The SHA-256 of a text, as the provenance of a page writes it: lower-case hexadecimal of the UTF-8 bytes. */
export const sha256Of = (text: string): string => createHash('sha256').update(text).digest('hex');
