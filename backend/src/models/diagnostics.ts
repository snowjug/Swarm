import { AppError } from '../errors.js';
import type { ReasoningEffort } from './call.js';
import type { ModelRole } from './task.js';
import type { FinishReason } from './telemetry.js';

/**
 * What one reply that could not be used looked like, from counts and closed sets only. It is made to be
 * recorded and shown: nothing in it is a word the model wrote or a word a person did, so it can never
 * carry a prompt, a passage or a name. A reply that was cut off at its limit and one that was whole but
 * was refused are different failures with different remedies, and say so.
 */
export interface ReplyDiagnostics {
  role: ModelRole | null;
  /** Why the provider ended its reply. */
  finishReason: FinishReason | null;
  /** The tokens the reply used, as the provider counted them, and the hidden thinking among them. */
  outputTokens: number;
  reasoningTokens: number | null;
  /** The most the reply was allowed, and the effort it was asked at (null: none was sent). */
  maxOutputTokens: number;
  effort: ReasoningEffort | null;
  /** For a whole reply that was refused: which kind of check it failed. */
  rejection?: 'not_json' | 'schema' | 'validation' | 'injection_echo';
  /** For a cut-off reply: it had already been asked for again, once, with more room and less thinking. */
  retried?: boolean;
}

/** An error of a reply the client could not use, with the diagnostics of that reply. */
export class ModelReplyError extends AppError {
  constructor(
    statusCode: number,
    code: 'MODEL_TRUNCATED' | 'MODEL_OUTPUT_INVALID',
    message: string,
    public readonly diagnostics: ReplyDiagnostics,
    options?: ErrorOptions,
  ) {
    super(statusCode, code, message, options);
    this.name = 'ModelReplyError';
  }
}

const count = (value: number): string => value.toLocaleString('en-US');

const REJECTIONS: Record<NonNullable<ReplyDiagnostics['rejection']>, string> = {
  not_json: 'it was not one JSON object',
  schema: 'it did not match the schema',
  validation: 'it failed the server’s checks',
  injection_echo: 'it repeated an instruction from the data',
};

/** The tokens, effort and role of a reply as one short clause. */
function measure(diagnostics: ReplyDiagnostics): string {
  const { outputTokens, reasoningTokens, maxOutputTokens, effort, role } = diagnostics;
  const thinking =
    reasoningTokens === null ? '' : `, ${count(reasoningTokens)} of them hidden reasoning`;
  return [
    `${count(outputTokens)} of ${count(maxOutputTokens)} output tokens${thinking}`,
    effort === null ? 'no reasoning effort sent' : `reasoning effort ${effort}`,
    ...(role === null ? [] : [`role ${role}`]),
  ].join('; ');
}

/** What a person is told when a reply ended at its limit and was not used. */
export function truncationMessage(diagnostics: ReplyDiagnostics): string {
  const spent = diagnostics.reasoningTokens ?? 0;
  const mostlyThinking = diagnostics.outputTokens > 0 && spent >= diagnostics.outputTokens * 0.9;
  return (
    `The model’s reply was cut off at its output limit, so it was not used (finish_reason length; ${measure(diagnostics)}).` +
    (diagnostics.retried
      ? ' It had already been asked for again once, with more room and less thinking.'
      : '') +
    (mostlyThinking
      ? ' Almost all of the limit went on hidden reasoning: use a deployment that reasons less, or none.'
      : '')
  );
}

/** The part of a whole-but-refused reply's failure that says what kind of reply it was. */
export function rejectionLine(diagnostics: ReplyDiagnostics): string {
  const why = diagnostics.rejection ? `${REJECTIONS[diagnostics.rejection]}; ` : '';
  const finish = diagnostics.finishReason ? `finish_reason ${diagnostics.finishReason}; ` : '';
  return `Last reply was complete but was not accepted: ${why}${finish}${measure(diagnostics)}.`;
}

/**
 * The same facts as a clause to put after the fixed sentence of a persisted failure. It is short on
 * purpose (a stored failure is limited to a few hundred characters) and, like all of it, only counts and
 * closed-set words.
 */
export function failureClause(diagnostics: ReplyDiagnostics): string {
  const { finishReason, rejection } = diagnostics;
  const kind =
    finishReason === 'length'
      ? `cut off at its limit${diagnostics.retried ? ', asked again once' : ''}`
      : `complete but refused${rejection ? ` (${rejection.replace('_', ' ')})` : ''}`;
  return `${kind}; ${measure(diagnostics)}`;
}
