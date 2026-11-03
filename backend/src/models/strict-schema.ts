import { z } from 'zod';

/**
 * Turns the zod schema of a task into the schema of a strict structured output, and back again.
 *
 * Strict mode asks the provider to constrain the model to a schema, which has rules the zod schema
 * does not: every object lists every property as required and closes itself to others, an optional
 * property is a property that may be null, a union is `anyOf`, and a good part of JSON Schema is not
 * accepted at all (lengths, ranges, patterns, counts). So the conversion can only ever be a request
 * to the model. What is accepted is still decided by the zod schema and the server's own checks, on
 * the reply as it came; `normalize` only gives a reply back the shape the zod schema expects, by
 * dropping the nulls that strict mode asked for in place of an absent optional property.
 *
 * A schema that strict mode cannot express (a map with free keys, a tuple, an untyped value) is not
 * converted: the caller asks for plain JSON and the zod schema and prompt carry the contract.
 */
export interface StrictSchema {
  /** The name of the output as the provider sees it: 1-64 letters, digits, underscores and hyphens. */
  name: string;
  /** The value of `response_format.json_schema.schema`. */
  schema: Record<string, unknown>;
  /** Replaces the null of an optional property by its absence. Never changes a reply that is valid as it is. */
  normalize(value: unknown): unknown;
}

export type StrictConversion = { ok: true; strict: StrictSchema } | { ok: false; reason: string };

type Node = Record<string, unknown>;

/** What was made nullable for strict mode, and so what `normalize` may turn back into an absence. */
interface Optionality {
  optional?: Set<string>;
  properties?: Map<string, Optionality>;
  items?: Optionality;
  variants?: Optionality[];
  reference?: string;
}

class Unsupported extends Error {}

const MAX_DEPTH = 10;
const MAX_PROPERTIES = 1_000;
const MAX_SCHEMA_CHARS = 60_000;
const MAX_HINT = 300;
// What zod adds to an integer's bounds: they say nothing a person meant.
const SAFE_BOUND = Number.MAX_SAFE_INTEGER;

/**
 * Keywords whose presence means the schema says something strict mode cannot be asked for. Every other
 * keyword that strict mode does not take (lengths, ranges, patterns, counts, defaults, titles) is
 * dropped by construction: a converted node is built from the few keywords that are kept, and the
 * ones a person can read are given back as a hint in the description.
 */
const REFUSED = [
  'patternProperties',
  'propertyNames',
  'unevaluatedProperties',
  'unevaluatedItems',
  'prefixItems',
  'additionalItems',
  'contains',
  'minContains',
  'maxContains',
  'not',
  'if',
  'then',
  'else',
  'dependentSchemas',
  'dependentRequired',
  '$dynamicRef',
  '$anchor',
];

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function hint(node: Node): string[] {
  const hints: string[] = [];
  const number = (key: string): number | null => {
    const value = node[key];
    return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < SAFE_BOUND
      ? value
      : null;
  };
  const [minLength, maxLength] = [number('minLength'), number('maxLength')];
  if (minLength !== null && maxLength !== null)
    hints.push(`${minLength} to ${maxLength} characters`);
  else if (maxLength !== null) hints.push(`at most ${maxLength} characters`);
  else if (minLength !== null && minLength > 0) hints.push(`at least ${minLength} characters`);
  const [minItems, maxItems] = [number('minItems'), number('maxItems')];
  if (minItems !== null && minItems > 0 && maxItems !== null)
    hints.push(`${minItems} to ${maxItems} items`);
  else if (maxItems !== null) hints.push(`at most ${maxItems} items`);
  else if (minItems !== null && minItems > 0) hints.push(`at least ${minItems} items`);
  const [min, max] = [number('minimum'), number('maximum')];
  if (min !== null && max !== null) hints.push(`from ${min} to ${max}`);
  else if (min !== null) hints.push(`at least ${min}`);
  else if (max !== null) hints.push(`at most ${max}`);
  const multiple = number('multipleOf');
  if (multiple !== null) hints.push(`a multiple of ${multiple}`);
  if (typeof node.pattern === 'string' && node.pattern.length <= 80) {
    hints.push(`matching the pattern ${node.pattern}`);
  }
  if (typeof node.format === 'string' && node.format.length <= 24) {
    hints.push(`format ${node.format}`);
  }
  return hints;
}

function described(node: Node, extra: string[] = []): { description?: string } {
  const parts = [typeof node.description === 'string' ? node.description : '', ...extra]
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return {};
  const joined = parts.join('. ');
  return { description: joined.length > MAX_HINT ? `${joined.slice(0, MAX_HINT - 1)}…` : joined };
}

const nullType = (node: Node): boolean =>
  node.type === 'null' || (Array.isArray(node.type) && node.type.includes('null'));

const allowsNull = (node: Node): boolean =>
  nullType(node) ||
  (Array.isArray(node.anyOf) &&
    node.anyOf.some((variant) => isNode(variant) && allowsNull(variant)));

/** The same node, except that null is also a valid value. */
function nullable(node: Node): Node {
  if (allowsNull(node)) return node;
  const { description, ...rest } = node;
  const note = 'Null when there is nothing to give.';
  const text = typeof description === 'string' ? `${description}. ${note}` : note;
  if (typeof rest.type === 'string' && rest.type !== 'object' && rest.type !== 'array') {
    return {
      ...rest,
      type: [rest.type, 'null'],
      ...(Array.isArray(rest.enum) ? { enum: [...rest.enum, null] } : {}),
      description: text,
    };
  }
  const variants = Array.isArray(rest.anyOf) ? rest.anyOf : [rest];
  return { anyOf: [...variants, { type: 'null' }], description: text };
}

function primitiveTypeOf(values: unknown[]): string | null {
  const kinds = new Set(
    values.map((value) =>
      typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : 'number') : typeof value,
    ),
  );
  if (kinds.size === 1) {
    const [kind] = [...kinds];
    return kind === 'string' || kind === 'boolean' || kind === 'number' || kind === 'integer'
      ? kind
      : null;
  }
  if (kinds.size === 2 && kinds.has('integer') && kinds.has('number')) return 'number';
  return null;
}

interface Counter {
  properties: number;
}

function convert(
  node: Node,
  counter: Counter,
  depth: number,
): { node: Node; optionality: Optionality } {
  if (depth > MAX_DEPTH) throw new Unsupported('The schema is nested too deeply.');
  for (const key of REFUSED) {
    if (key in node) throw new Unsupported(`The schema uses ${key}.`);
  }

  if (typeof node.$ref === 'string') {
    if (!/^#\/\$defs\/[A-Za-z0-9_-]{1,64}$/u.test(node.$ref)) {
      throw new Unsupported('The schema has a reference that is not to its own definitions.');
    }
    return {
      node: { $ref: node.$ref },
      optionality: { reference: node.$ref.slice('#/$defs/'.length) },
    };
  }

  const alternatives = (node.anyOf ?? node.oneOf) as unknown;
  if (alternatives !== undefined) {
    if (!Array.isArray(alternatives) || alternatives.length === 0 || !alternatives.every(isNode)) {
      throw new Unsupported('The schema has a union that cannot be read.');
    }
    const converted = alternatives.map((variant) => convert(variant, counter, depth + 1));
    return {
      node: {
        anyOf: converted.map((entry) => entry.node),
        ...described(node, hint(node)),
      },
      optionality: { variants: converted.map((entry) => entry.optionality) },
    };
  }
  if ('allOf' in node) {
    const { allOf: parts, ...rest } = node;
    const only = Array.isArray(parts) && parts.length === 1 ? parts[0] : null;
    if (!isNode(only)) throw new Unsupported('The schema combines schemas with allOf.');
    return convert({ ...rest, ...only }, counter, depth);
  }

  if ('const' in node || Array.isArray(node.enum)) {
    const values = 'const' in node ? [node.const] : (node.enum as unknown[]);
    const present = values.filter((value) => value !== null);
    const type = primitiveTypeOf(present);
    if (values.length === 0 || (type === null && present.length > 0)) {
      throw new Unsupported('The schema has a value list that is not of one primitive type.');
    }
    const kinds =
      type === null ? {} : { type: present.length < values.length ? [type, 'null'] : type };
    return { node: { ...kinds, enum: values, ...described(node) }, optionality: {} };
  }

  const type = node.type;
  if (Array.isArray(type)) {
    const kinds = type.filter((kind) => kind !== 'null');
    if (kinds.some((kind) => kind === 'object' || kind === 'array')) {
      throw new Unsupported('The schema has a nullable object or array written as a type list.');
    }
    return {
      node: { type, ...described(node, hint(node)) },
      optionality: {},
    };
  }

  switch (type) {
    case 'string':
    case 'number':
    case 'integer':
    case 'boolean':
    case 'null':
      return { node: { type, ...described(node, hint(node)) }, optionality: {} };
    case 'array': {
      if (!isNode(node.items))
        throw new Unsupported('The schema has an array without an item type.');
      const item = convert(node.items, counter, depth + 1);
      return {
        node: { type: 'array', items: item.node, ...described(node, hint(node)) },
        optionality: { items: item.optionality },
      };
    }
    case 'object': {
      const extra = node.additionalProperties;
      if (extra !== undefined && extra !== false) {
        throw new Unsupported('The schema has an object with keys that are not named.');
      }
      const properties = isNode(node.properties) ? node.properties : {};
      const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
      const out: Record<string, Node> = {};
      const optional = new Set<string>();
      const nested = new Map<string, Optionality>();
      for (const [name, child] of Object.entries(properties)) {
        if (!isNode(child)) throw new Unsupported('The schema has a property that cannot be read.');
        counter.properties += 1;
        if (counter.properties > MAX_PROPERTIES) throw new Unsupported('The schema is too large.');
        const converted = convert(child, counter, depth + 1);
        nested.set(name, converted.optionality);
        if (required.has(name)) {
          out[name] = converted.node;
        } else {
          out[name] = nullable(converted.node);
          if (!allowsNull(converted.node)) optional.add(name);
        }
      }
      return {
        node: {
          type: 'object',
          properties: out,
          required: Object.keys(out),
          additionalProperties: false,
          ...described(node),
        },
        optionality: { optional, properties: nested },
      };
    }
    default:
      throw new Unsupported('The schema has a value with no type.');
  }
}

/** A name the provider accepts, from a task name such as `actor-proposal.v1`. */
export function strictSchemaName(raw: string | undefined): string {
  const name = (raw ?? '').replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 64);
  return name || 'swarm_reply';
}

function restore(
  value: unknown,
  optionality: Optionality | undefined,
  definitions: ReadonlyMap<string, Optionality>,
  depth = 0,
): unknown {
  if (!optionality || depth > 64) return value;
  if (optionality.reference !== undefined) {
    return restore(value, definitions.get(optionality.reference), definitions, depth + 1);
  }
  let current = value;
  for (const variant of optionality.variants ?? []) {
    current = restore(current, variant, definitions, depth + 1);
  }
  if (Array.isArray(current)) {
    const item = optionality.items;
    return item ? current.map((entry) => restore(entry, item, definitions, depth + 1)) : current;
  }
  if (isNode(current) && (optionality.properties || optionality.optional)) {
    const out: Node = { ...current };
    for (const name of optionality.optional ?? []) {
      if (out[name] === null) delete out[name];
    }
    for (const [name, child] of optionality.properties ?? []) {
      if (name in out) out[name] = restore(out[name], child, definitions, depth + 1);
    }
    return out;
  }
  return current;
}

export function toStrictSchema(schema: z.ZodType, name?: string): StrictConversion {
  let source: Node;
  try {
    const generated: unknown = z.toJSONSchema(schema, {
      io: 'input',
      unrepresentable: 'any',
    });
    if (!isNode(generated)) return { ok: false, reason: 'The schema has no JSON form.' };
    source = generated;
  } catch {
    return { ok: false, reason: 'The schema has no JSON form.' };
  }
  try {
    if (source.type !== 'object') throw new Unsupported('The root of the schema is not an object.');
    const counter: Counter = { properties: 0 };
    const root = convert(source, counter, 0);
    const definitions = new Map<string, Optionality>();
    const converted: Record<string, Node> = {};
    const sourceDefinitions = isNode(source.$defs) ? source.$defs : {};
    for (const [key, definition] of Object.entries(sourceDefinitions)) {
      if (!isNode(definition))
        throw new Unsupported('The schema has a definition that cannot be read.');
      const entry = convert(definition, counter, 1);
      converted[key] = entry.node;
      definitions.set(key, entry.optionality);
    }
    const strictRoot: Node = {
      ...root.node,
      ...(Object.keys(converted).length > 0 ? { $defs: converted } : {}),
    };
    if (JSON.stringify(strictRoot).length > MAX_SCHEMA_CHARS) {
      throw new Unsupported('The schema is too large.');
    }
    return {
      ok: true,
      strict: {
        name: strictSchemaName(name),
        schema: strictRoot,
        normalize: (value) => restore(value, root.optionality, definitions),
      },
    };
  } catch (error) {
    if (error instanceof Unsupported) return { ok: false, reason: error.message };
    throw error;
  }
}
