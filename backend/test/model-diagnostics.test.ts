import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors.js';
import {
  failureClause,
  ModelReplyError,
  rejectionLine,
  truncationMessage,
  type ReplyDiagnostics,
} from '../src/models/diagnostics.js';
import { taskFailure } from '../src/models/task.js';
import { modelCallOutcome } from '../src/models/telemetry.js';

// What is said about a reply that could not be used is made from counts and closed-set words, so that it
// can be stored, shown and sent to monitoring without a word of the model's or of the data in it.

const cutOff: ReplyDiagnostics = {
  role: 'actor',
  finishReason: 'length',
  outputTokens: 9_000,
  reasoningTokens: 8_900,
  maxOutputTokens: 9_000,
  effort: 'minimal',
  retried: true,
};

describe('how a round trip is classed', () => {
  it.each([
    [{ ok: true, repair: false, errorCode: null }, 'ok'],
    [{ ok: true, repair: true, errorCode: null }, 'repaired'],
    [{ ok: false, repair: false, errorCode: 'MODEL_TRUNCATED' }, 'truncated'],
    [{ ok: false, repair: true, errorCode: 'MODEL_TRUNCATED' }, 'truncated'],
    [{ ok: false, repair: false, errorCode: 'MODEL_OUTPUT_INVALID' }, 'schema-invalid'],
    [{ ok: false, repair: true, errorCode: 'MODEL_OUTPUT_INVALID' }, 'schema-invalid'],
    [{ ok: false, repair: false, errorCode: 'MODEL_AUTH' }, 'failed'],
    [{ ok: false, repair: false, errorCode: 'MODEL_RATE_LIMIT' }, 'failed'],
    [{ ok: false, repair: false, errorCode: null }, 'failed'],
  ] as const)('%j is %s', (event, outcome) => {
    expect(modelCallOutcome(event)).toBe(outcome);
  });
});

describe('what is said about a reply that was cut off', () => {
  it('gives the limit, what was used, what went on thinking and the effort, as numbers', () => {
    const message = truncationMessage(cutOff);
    expect(message).toContain('finish_reason length');
    expect(message).toContain('9,000 of 9,000 output tokens, 8,900 of them hidden reasoning');
    expect(message).toContain('reasoning effort minimal');
    expect(message).toContain('role actor');
    expect(message).toContain('asked for again once');
  });

  it('points at the thinking only when nearly all of the limit went on it', () => {
    expect(truncationMessage(cutOff)).toContain('hidden reasoning: use a deployment');
    const long = truncationMessage({ ...cutOff, reasoningTokens: 100, retried: false });
    expect(long).not.toContain('use a deployment');
    expect(long).not.toContain('asked for again');
    // A provider that does not say what the thinking was is not guessed about.
    const unsaid = truncationMessage({ ...cutOff, reasoningTokens: null });
    expect(unsaid).not.toContain('hidden reasoning');
    expect(unsaid).not.toContain('use a deployment');
  });

  it('says so when no effort was sent', () => {
    expect(truncationMessage({ ...cutOff, effort: null, role: null })).toContain(
      'no reasoning effort sent',
    );
  });
});

describe('what is said about a whole reply that was not accepted', () => {
  it('names the kind of check it failed, and that it was whole', () => {
    const line = rejectionLine({
      ...cutOff,
      finishReason: 'stop',
      outputTokens: 800,
      reasoningTokens: 0,
      rejection: 'schema',
    });
    expect(line).toContain('complete but was not accepted: it did not match the schema');
    expect(line).toContain('finish_reason stop');
    expect(line).toContain('800 of 9,000 output tokens, 0 of them hidden reasoning');
    expect(line).not.toContain('cut off');
  });
});

describe('the stored failure of a task', () => {
  it('keeps the fixed sentence and adds the counts when the client knows them', () => {
    const failure = taskFailure(
      'MODEL_TRUNCATED',
      new ModelReplyError(502, 'MODEL_TRUNCATED', truncationMessage(cutOff), cutOff),
    );
    expect(failure.code).toBe('MODEL_TRUNCATED');
    expect(failure.detail).toBe(
      'The model’s answer was cut short, so rules were used. (cut off at its limit, asked again once; 9,000 of 9,000 output tokens, 8,900 of them hidden reasoning; reasoning effort minimal; role actor)',
    );
    expect(failureClause({ ...cutOff, finishReason: 'stop', rejection: 'validation' })).toContain(
      'complete but refused (validation)',
    );
  });

  it('is the fixed sentence alone for an error that carries no diagnostics, as it always was', () => {
    expect(
      taskFailure('MODEL_OUTPUT_INVALID', new AppError(502, 'MODEL_OUTPUT_INVALID', 'x')),
    ).toEqual({
      code: 'MODEL_OUTPUT_INVALID',
      detail: 'The model replied, but its answer did not pass validation, so rules were used.',
    });
    expect(taskFailure('MODEL_AUTH').detail).toBe(
      'The model rejected the server’s credentials, so rules were used.',
    );
  });

  it('never grows past what a stored failure may hold: it falls back to the fixed sentence', () => {
    const huge = { ...cutOff, outputTokens: 1e300, maxOutputTokens: 1e300 };
    const failure = taskFailure(
      'MODEL_TRUNCATED',
      new ModelReplyError(502, 'MODEL_TRUNCATED', truncationMessage(huge), huge),
    );
    expect(failure.detail).toBe('The model’s answer was cut short, so rules were used.');
  });
});
