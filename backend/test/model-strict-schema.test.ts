import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  actorDecisionSchema,
  answerSchema,
  extractedGraphSchema,
  generatedReportSchema,
  personasSchema,
} from '../src/models/schemas.js';
import { strictSchemaName, toStrictSchema } from '../src/models/strict-schema.js';
import { entailmentSchema } from '../src/grounding/entailment.js';
import {
  generatedEnvironmentSchema,
  guidedGraphSchema,
  interviewSchema,
  reportChapterSchema,
  reportPlanSchema,
} from '../src/guided/schemas.js';
import { modelFrameSchema } from '../src/scenario/model.js';
import { ontologySchema } from '../../shared/guided.js';
import { strictSchemaProblems } from './support/fake-foundry.js';

// Strict structured output is a request to the model; the zod schema stays the judge. So the
// conversion is checked two ways: against the rules of strict mode, written out independently in the
// fake Foundry server, and by turning what a strict model would write back into what zod accepts.

const convert = (schema: z.ZodType, name = 'task.v1') => {
  const result = toStrictSchema(schema, name);
  if (!result.ok) throw new Error(`not converted: ${result.reason}`);
  return result.strict;
};

describe('the schemas the product already sends to models', () => {
  const real: Array<[string, z.ZodType]> = [
    ['extractedGraph', extractedGraphSchema],
    ['personas', personasSchema],
    ['actorDecision', actorDecisionSchema],
    ['generatedReport', generatedReportSchema],
    ['answer', answerSchema],
    ['entailment', entailmentSchema],
    ['guidedGraph', guidedGraphSchema],
    ['generatedEnvironment', generatedEnvironmentSchema],
    ['reportPlan', reportPlanSchema],
    ['reportChapter', reportChapterSchema],
    ['interview', interviewSchema],
    ['ontology', ontologySchema],
    ['scenarioFrame', modelFrameSchema],
  ];

  it.each(real)('%s is converted, or is not converted for a stated reason', (_name, schema) => {
    const result = toStrictSchema(schema, 'real.v1');
    if (result.ok) {
      expect(strictSchemaProblems(result.strict.schema)).toEqual([]);
      expect(JSON.stringify(result.strict.schema).length).toBeLessThan(60_000);
    } else {
      expect(result.reason.length).toBeGreaterThan(10);
    }
  });

  it('converts most of them: strict output is the rule and plain JSON the exception', () => {
    const converted = real.filter(([, schema]) => toStrictSchema(schema).ok);
    expect(converted.length).toBeGreaterThanOrEqual(Math.ceil(real.length * 0.75));
  });
});

describe('what strict mode asks for', () => {
  it('closes every object, requires every property, and says what it cannot say in words', () => {
    const { schema } = convert(
      z.object({
        id: z.string().regex(/^S[1-9]\d*$/u),
        weight: z.number().min(0.1).max(1),
        count: z.int().min(1),
        kind: z.enum(['topic', 'person']),
        items: z
          .array(z.object({ label: z.string().min(2).max(80) }))
          .min(1)
          .max(5),
      }),
    );
    expect(strictSchemaProblems(schema)).toEqual([]);
    const text = JSON.stringify(schema);
    expect(text).not.toMatch(
      /"(?:minLength|maxLength|pattern|minimum|maximum|minItems|maxItems)"/u,
    );
    expect(text).toContain('matching the pattern ^S[1-9]\\\\d*$');
    expect(text).toContain('from 0.1 to 1');
    expect(text).toContain('1 to 5 items');
    expect(text).toContain('2 to 80 characters');
    // The safe-integer bounds zod adds to an integer say nothing a person meant.
    expect(text).not.toContain('9007199254740991');
  });

  it('turns an optional or defaulted property into a required one that may be null', () => {
    const { schema } = convert(
      z.object({
        name: z.string(),
        nick: z.string().optional(),
        tags: z.array(z.string()).optional(),
        score: z.number().default(3),
        meta: z.object({ a: z.string() }).optional(),
        mood: z.enum(['up', 'down']).optional(),
      }),
    );
    expect(strictSchemaProblems(schema)).toEqual([]);
    const properties = (schema as { properties: Record<string, Record<string, unknown>> })
      .properties;
    expect(properties.nick?.type).toEqual(['string', 'null']);
    expect(properties.score?.type).toEqual(['number', 'null']);
    expect(JSON.stringify(properties.tags)).toContain('"type":"null"');
    expect(JSON.stringify(properties.meta)).toContain('"type":"null"');
    // An enum that may be null must list null, or null is not one of its values.
    expect(properties.mood?.enum).toEqual(['up', 'down', null]);
    expect(properties.name?.type).toBe('string');
  });

  it('writes a union as anyOf, a literal as an enum, and keeps a nullable property as it is', () => {
    const { schema } = convert(
      z.object({
        shape: z.discriminatedUnion('t', [
          z.object({ t: z.literal('a'), v: z.string() }),
          z.object({ t: z.literal('b'), w: z.number() }),
        ]),
        either: z.union([z.string(), z.number()]),
        label: z.string().nullable(),
      }),
    );
    const text = JSON.stringify(schema);
    expect(strictSchemaProblems(schema)).toEqual([]);
    expect(text).not.toMatch(/oneOf|"const"/u);
    expect(text).toContain('"enum":["a"]');
    const label = (schema as { properties: { label: { type: unknown } } }).properties.label;
    expect(label.type).toEqual(['string', 'null']);
  });

  it('names the output with characters the provider accepts', () => {
    expect(strictSchemaName('actor-proposal.v1')).toBe('actor-proposal_v1');
    expect(strictSchemaName('a b/c?')).toBe('a_b_c_');
    expect(strictSchemaName(undefined)).toBe('swarm_reply');
    expect(strictSchemaName('x'.repeat(100))).toHaveLength(64);
    expect(convert(z.object({ a: z.string() }), 'needs review!').name).toBe('needs_review_');
  });

  it.each([
    ['a map with free keys', z.object({ x: z.record(z.string(), z.number()) })],
    ['a tuple', z.object({ x: z.tuple([z.string(), z.number()]) })],
    ['a value of any type', z.object({ x: z.unknown() })],
    ['an object that allows other keys', z.object({ a: z.string() }).loose()],
    ['an array at the root', z.array(z.object({ a: z.string() }))],
    ['a string at the root', z.string()],
    ['a union at the root', z.union([z.object({ a: z.string() }), z.object({ b: z.string() })])],
  ])('does not convert %s, and says it was not converted', (_name, schema) => {
    const result = toStrictSchema(schema, 'x');
    expect(result.ok).toBe(false);
  });

  it('reads an intersection of objects as one object, and mixed literals as a union', () => {
    const { schema } = convert(
      z.object({
        merged: z.intersection(z.object({ a: z.string() }), z.object({ b: z.string() })),
        mixed: z.union([z.literal('a'), z.literal(1)]),
      }),
    );
    expect(strictSchemaProblems(schema)).toEqual([]);
    const properties = (schema as { properties: Record<string, Record<string, unknown>> })
      .properties;
    expect(properties.merged?.required).toEqual(['a', 'b']);
    expect(properties.mixed?.anyOf).toHaveLength(2);
  });

  it('does not convert a schema that is too deep or too large for the provider', () => {
    let deep: z.ZodType = z.object({ leaf: z.string() });
    for (let level = 0; level < 12; level += 1) deep = z.object({ next: deep });
    expect(toStrictSchema(deep, 'x')).toMatchObject({ ok: false });
    const wide = z.object(
      Object.fromEntries(Array.from({ length: 1_100 }, (_, index) => [`p${index}`, z.string()])),
    );
    expect(toStrictSchema(wide, 'x')).toMatchObject({ ok: false });
  });
});

describe('turning a strict reply back into the shape the schema expects', () => {
  const schema = z.object({
    answer: z.string(),
    notes: z.array(z.object({ text: z.string(), source: z.string().optional() })).optional(),
    nested: z.object({ detail: z.string().optional(), size: z.number() }),
    pick: z.union([z.object({ kind: z.literal('a'), extra: z.string().optional() }), z.string()]),
    label: z.string().nullable().optional(),
    rank: z.number().default(1),
  });

  it('drops a null only where strict mode put it in place of an absent property', () => {
    const { normalize } = convert(schema);
    const reply = {
      answer: 'x',
      notes: [
        { text: 'one', source: null },
        { text: 'two', source: 's' },
      ],
      nested: { detail: null, size: 2 },
      pick: { kind: 'a', extra: null },
      label: null,
      rank: null,
    };
    expect(normalize(reply)).toEqual({
      answer: 'x',
      notes: [{ text: 'one' }, { text: 'two', source: 's' }],
      nested: { size: 2 },
      pick: { kind: 'a' },
      // The schema allows null here by itself, so it is a value and stays.
      label: null,
    });
    expect(schema.parse(normalize(reply))).toMatchObject({ rank: 1 });
  });

  it('does not touch a null for a property that is required, and the schema then rejects it', () => {
    const { normalize } = convert(schema);
    const reply = { answer: null, nested: { size: null }, pick: 'a', notes: null, rank: 1 };
    const normalized = normalize(reply) as Record<string, unknown>;
    expect(normalized.answer).toBeNull();
    expect(normalized.nested).toEqual({ size: null });
    expect('notes' in normalized).toBe(false);
    expect(schema.safeParse(normalized).success).toBe(false);
  });

  it('leaves a reply with no nulls, and what is not an object, exactly as it is', () => {
    const { normalize } = convert(schema);
    const reply = { answer: 'x', nested: { size: 1 }, pick: 'a' };
    expect(normalize(reply)).toEqual(reply);
    expect(normalize('text')).toBe('text');
    expect(normalize(null)).toBeNull();
    expect(normalize([1, null])).toEqual([1, null]);
  });
});

describe('a reference to a definition', () => {
  it('is kept, and converted like any other part of the schema', () => {
    const node: z.ZodType = z.object({
      name: z.string(),
      children: z.array(z.lazy(() => node)).optional(),
    });
    const result = toStrictSchema(node, 'tree.v1');
    // Whether zod writes this as a reference, or inlines it, what is returned obeys the rules.
    if (result.ok) expect(strictSchemaProblems(result.strict.schema)).toEqual([]);
    else expect(result.reason.length).toBeGreaterThan(0);
  });
});
