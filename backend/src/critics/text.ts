import { createHash } from 'node:crypto';
import {
  CRITIQUE_SEVERITIES,
  type CriticRole,
  type Critique,
  type CritiqueSeverity,
} from '../../../shared/critique.js';
import type { EvidenceRef } from '../../../shared/evidence.js';

/** Collapses whitespace and cuts to `max` characters, marking the cut. */
export function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/gu, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Two decimals, never "-0.00". */
export const fixed = (value: number): string => (Math.round(value * 100) / 100).toFixed(2);
export const signed = (value: number): string => `${value > 0 ? '+' : ''}${fixed(value)}`;
/** Up to three decimals without trailing zeros, so that an intensity of 0.001 is not shown as 0.00. */
export const level = (value: number): string => String(Math.round(value * 1000) / 1000);

export const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

/** "A, B and 2 more": a list that stays one short line however long it is. */
export function names(items: readonly string[], shown = 4): string {
  const quoted = items.slice(0, shown).map((item) => clip(item, 40));
  const more = items.length - quoted.length;
  return more > 0 ? `${quoted.join(', ')} and ${more} more` : quoted.join(', ');
}

/** "riskTolerance" as "risk tolerance". */
export const words = (key: string): string => key.replace(/([A-Z])/gu, ' $1').toLowerCase();

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'all', 'any', 'its', 'their']);

/** Lower-case words of three letters or more, with a plain plural reduced to its singular. */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
    .map((token) =>
      token.length > 3 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token,
    );
}

/** The share of the words of `wanted` that `available` also holds. */
export function overlap(wanted: readonly string[], available: ReadonlySet<string>): number {
  if (wanted.length === 0) return 1;
  return wanted.filter((token) => available.has(token)).length / wanted.length;
}

export function hash8(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 8);
}

/** A stable id of at most 80 characters: a long key is cut and made unique by a hash of the whole. */
export function stableId(prefix: string, key: string): string {
  const id = `${prefix}-${key}`;
  return id.length <= 80 ? id : `${id.slice(0, 71)}-${hash8(id)}`;
}

export const severityRank = (severity: CritiqueSeverity): number =>
  CRITIQUE_SEVERITIES.indexOf(severity);

/** Plain, locale-independent ordering, so that the same input is always sorted the same way. */
export const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The analysis as a whole, for an objection that is not about one finding or one stakeholder. */
export const whole = (analysisId: string): Critique['target'] => ({
  kind: 'analysis',
  id: analysisId,
});

export interface Draft {
  id: string;
  role: CriticRole;
  target: Critique['target'];
  severity: CritiqueSeverity;
  objection: string;
  /** The checked facts, one line each. */
  basis: string[];
  evidence?: EvidenceRef[];
  /** What changes in the conclusion if the objection stands. */
  impact: string;
  /** The next step the objection asks for. Most criticisms only qualify the result and have none. */
  action?: string;
}

/** A rules critique: every one is `origin: 'rules'`, open, and with no response. */
export function draft(now: string, fields: Draft): Critique {
  return {
    id: fields.id,
    role: fields.role,
    target: { kind: fields.target.kind, id: fields.target.id.slice(0, 80) },
    severity: fields.severity,
    objection: clip(fields.objection, 800),
    basis: fields.basis.slice(0, 6).map((line) => clip(line, 200)),
    evidence: (fields.evidence ?? []).slice(0, 5),
    origin: 'rules',
    status: 'open',
    response: null,
    remainingDisagreement: null,
    impactOnConclusion: clip(fields.impact, 500),
    ...(fields.action ? { requestedAction: clip(fields.action, 300) } : {}),
    createdAt: now,
  };
}
