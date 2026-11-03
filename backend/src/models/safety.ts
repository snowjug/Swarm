import { AppError } from '../errors.js';

/**
 * What a provider's content safety says about one call, read from the annotations Azure adds to a
 * reply (`prompt_filter_results`, `choices[].content_filter_results`, `finish_reason`, the `refusal`
 * of a message) and from the error of a request it blocked.
 *
 * A block is never answered from rules or accepted in part: the call fails with `MODEL_REFUSED` and
 * the caller is told which kind of block it was. A detection that did not block (the service saw what
 * looks like a jailbreak or an instruction inside a document, and let the call through) is a signal:
 * it is counted and handed to the caller, and the reply is judged as any other reply is.
 */
export type SafetyClass =
  | 'refusal'
  | 'blocked_input'
  | 'blocked_output'
  | 'jailbreak'
  | 'indirect_attack'
  | 'protected_material';

export type SafetyAction = 'blocked' | 'detected';

export interface SafetyFinding {
  class: SafetyClass;
  action: SafetyAction;
  /** The provider's name for the category, when it is a plain identifier. */
  category: string | null;
}

export interface SafetyReading {
  findings: SafetyFinding[];
  blocked: boolean;
}

const IDENTIFIER = /^[A-Za-z0-9_.-]{1,64}$/u;
const MAX_FINDINGS = 12;

const fields = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function classify(category: string, side: 'input' | 'output'): SafetyClass {
  if (category === 'jailbreak') return 'jailbreak';
  if (category === 'indirect_attack') return 'indirect_attack';
  if (category.startsWith('protected_material')) return 'protected_material';
  return side === 'input' ? 'blocked_input' : 'blocked_output';
}

/** The findings of one `content_filter_results` object. */
function fromAnnotation(results: unknown, side: 'input' | 'output'): SafetyFinding[] {
  const found: SafetyFinding[] = [];
  for (const [category, value] of Object.entries(fields(results))) {
    if (!IDENTIFIER.test(category)) continue;
    // Custom block lists are reported as a list in some API versions and as an object in others.
    const entries = Array.isArray(value) ? value.map(fields) : [fields(value)];
    const blocked = entries.some((entry) => entry.filtered === true);
    const detected = entries.some((entry) => entry.detected === true);
    if (!blocked && !detected) continue;
    found.push({
      class: classify(category, side),
      action: blocked ? 'blocked' : 'detected',
      category,
    });
  }
  return found;
}

/** The categories named by an HTTP 400 `content_filter` error, as findings about the request. */
export function fromBlockedRequest(categories: readonly string[]): SafetyFinding[] {
  const found = categories
    .filter((category) => IDENTIFIER.test(category))
    .map((category): SafetyFinding => ({
      class: classify(category, 'input'),
      action: 'blocked',
      category,
    }));
  return found.length > 0 ? found : [{ class: 'blocked_input', action: 'blocked', category: null }];
}

/** Reads the annotations of a 200 reply. Anything that is not where it should be is just not there. */
export function readSafety(response: unknown): SafetyReading {
  const body = fields(response);
  const findings: SafetyFinding[] = [];
  const prompts = body.prompt_filter_results ?? body.prompt_annotations;
  if (Array.isArray(prompts)) {
    for (const prompt of prompts.slice(0, 8)) {
      const entry = fields(prompt);
      findings.push(
        ...fromAnnotation(entry.content_filter_results ?? entry.content_filter_result, 'input'),
      );
    }
  }
  const choices = Array.isArray(body.choices) ? body.choices.slice(0, 4) : [];
  for (const choice of choices) {
    const entry = fields(choice);
    findings.push(...fromAnnotation(entry.content_filter_results, 'output'));
    if (
      entry.finish_reason === 'content_filter' &&
      !findings.some(
        (finding) => finding.class === 'blocked_output' && finding.action === 'blocked',
      )
    ) {
      findings.push({ class: 'blocked_output', action: 'blocked', category: null });
    }
    const refusal = fields(entry.message).refusal;
    if (typeof refusal === 'string' && refusal.length > 0) {
      findings.push({ class: 'refusal', action: 'blocked', category: null });
    }
  }
  const unique = new Map(
    findings.map((finding) => [`${finding.class}/${finding.action}/${finding.category}`, finding]),
  );
  const list = [...unique.values()].slice(0, MAX_FINDINGS);
  return { findings: list, blocked: list.some((finding) => finding.action === 'blocked') };
}

/** A call the provider declined or blocked. The code is `MODEL_REFUSED` and a refusal is never a fallback. */
export class ModelRefusedError extends AppError {
  constructor(
    message: string,
    public readonly findings: readonly SafetyFinding[],
  ) {
    super(422, 'MODEL_REFUSED', message);
    this.name = 'ModelRefusedError';
  }
}

const flagged = (findings: readonly SafetyFinding[]): string => {
  const names = [
    ...new Set(
      findings
        .filter((finding) => finding.action === 'blocked' && finding.category !== null)
        .map((finding) => finding.category as string),
    ),
  ].slice(0, 6);
  return names.length > 0 ? ` (flagged: ${names.join(', ')})` : '';
};

/** The error for a block, worded for what was blocked and never carrying text from the provider. */
export function refusalFor(findings: readonly SafetyFinding[]): ModelRefusedError {
  const blocked = findings.filter((finding) => finding.action === 'blocked');
  const output = blocked.some((finding) => finding.class === 'blocked_output');
  const input = blocked.some(
    (finding) =>
      finding.class === 'blocked_input' ||
      finding.class === 'jailbreak' ||
      finding.class === 'indirect_attack',
  );
  if (!output && !input) {
    return new ModelRefusedError(
      'The provider declined this request. Review the scenario and provider usage policy.',
      findings,
    );
  }
  const what = input ? 'request' : 'answer';
  return new ModelRefusedError(
    `The provider's content filter blocked this ${what}${flagged(blocked)}. No fallback was used. Review the scenario text or the deployment's content-filter policy.`,
    findings,
  );
}
