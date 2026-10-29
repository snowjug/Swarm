import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { DATASET_DIRECTORY } from './corpus.js';

export const SPLITS = ['dev', 'test'] as const;
export type Split = (typeof SPLITS)[number];
const split = z.enum(SPLITS);

const retrievalSchema = z.object({
  version: z.literal(1),
  questions: z
    .array(
      z.object({
        id: z.string(),
        split,
        question: z.string(),
        relevant: z.array(z.object({ document: z.string(), contains: z.string() })).min(1),
      }),
    )
    .min(1),
});

const ANSWERABILITY_KINDS = [
  'direct',
  'off-topic',
  'absent-year',
  'absent-topic',
  'plausible-absent',
] as const;
export type AnswerabilityKind = (typeof ANSWERABILITY_KINDS)[number];

const answerabilitySchema = z.object({
  version: z.literal(1),
  questions: z
    .array(
      z.object({
        id: z.string(),
        split,
        kind: z.enum(ANSWERABILITY_KINDS),
        answerable: z.boolean(),
        question: z.string(),
      }),
    )
    .min(1),
});

const contradictionSchema = z.object({
  version: z.literal(1),
  expected: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(['deterministic', 'semantic']),
        description: z.string(),
        documents: z.tuple([z.string(), z.string()]),
        mustContain: z.array(z.string()).min(1),
      }),
    )
    .min(1),
  knownNonConflicts: z.array(z.string()),
});

export const SUPPORT_GOLD = ['supported', 'partial', 'unsupported'] as const;
export type SupportGold = (typeof SUPPORT_GOLD)[number];

const claimsSchema = z.object({
  version: z.literal(1),
  claims: z
    .array(
      z.object({
        id: z.string(),
        split,
        kind: z.enum(['source-fact', 'extracted-claim']),
        documents: z.array(z.string()).min(1),
        gold: z.enum(SUPPORT_GOLD),
        text: z.string(),
      }),
    )
    .min(1),
});

const injectionSchema = z.object({
  version: z.literal(1),
  samples: z
    .array(
      z.object({
        id: z.string(),
        injection: z.boolean(),
        kind: z.enum(['direct', 'obfuscated', 'other-language', 'benign']),
        text: z.string(),
      }),
    )
    .min(1),
});

function read<T>(file: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(readFileSync(join(DATASET_DIRECTORY, file), 'utf8')));
}

export const loadRetrieval = () => read('retrieval.json', retrievalSchema);
export const loadAnswerability = () => read('answerability.json', answerabilitySchema);
export const loadContradictions = () => read('contradictions.json', contradictionSchema);
export const loadClaims = () => read('claims.json', claimsSchema);
export const loadInjection = () => read('injection.json', injectionSchema);

export type RetrievalSet = ReturnType<typeof loadRetrieval>;
export type AnswerabilitySet = ReturnType<typeof loadAnswerability>;
export type ContradictionSet = ReturnType<typeof loadContradictions>;
export type ClaimSet = ReturnType<typeof loadClaims>;
export type InjectionSet = ReturnType<typeof loadInjection>;
