import type { ScenarioDocument, ScenarioParseResult } from '../../../shared/scenario.js';
import { AppError } from '../errors.js';
import type { ModelGateway } from '../models/client.js';
import { inspectText, suspiciousPassageIds } from '../models/injection.js';
import { readByModel } from './model.js';
import { readByRules } from './rules.js';
import { normalise, plainName } from './text.js';

export interface ParseInput {
  /** The question as the person wrote it. Untrusted data: it is read, never obeyed. */
  question: string;
  /** What the person supplied. Names and sizes are listed as evidence; the excerpt is only inspected. */
  documents?: readonly ScenarioDocument[];
  /** Without one, or when it fails, the rules read the question and the notes say so. */
  model?: ModelGateway | null;
  /** The model's name, handed back so the person can see what read their question. */
  modelName?: string | null;
  signal?: AbortSignal;
}

export const RULES_NOTE =
  'Read by rules, not a model. The rules look for common patterns (an if or when clause, amounts, places, spans of time and named groups) and can miss or misread things: check every field.';

export const MODEL_NOTE =
  'Read by a model, then checked by the server: its shape, that ids are unique, and that every number is one the question states. A model can still misread a question: check every field.';

const FAILURES: Readonly<Record<string, string>> = {
  MODEL_OUTPUT_INVALID: 'its reply did not pass the checks',
  MODEL_TIMEOUT: 'it did not answer in time',
  MODEL_UNREACHABLE: 'it could not be reached',
  MODEL_AUTH: 'the provider did not accept the sign-in',
  MODEL_NOT_FOUND: 'the provider did not find the model',
  MODEL_HTTP_ERROR: 'the provider returned an error',
  MODEL_PROTOCOL: 'the provider returned an unexpected answer',
  MODEL_PARAMETER_UNSUPPORTED: 'the provider did not accept the request',
  MODEL_REFUSED: 'the provider declined the request',
  MODEL_RATE_LIMIT: 'the provider is limiting requests',
  MODEL_CALL_BUDGET: 'a usage limit was reached',
  PROJECT_BUDGET: 'a usage limit was reached',
  MODEL_NOT_CONFIGURED: 'no model is configured',
};

function failureNote(error: unknown): string {
  const code = error instanceof AppError ? error.code : 'MODEL_UNEXPECTED';
  return `The model could not read this question (${FAILURES[code] ?? 'something went wrong'}; ${code}), so the rules read it instead.`;
}

/** Warnings for text, in the question or a document, that reads as an instruction to an AI model. */
function injectionNotes(question: string, documents: readonly ScenarioDocument[]): string[] {
  const notes: string[] = [];
  if (inspectText(normalise(question).text).suspicious) {
    notes.push(
      'The question contains text that reads as an instruction to an AI model. It is treated as data and never followed, and it is left out of the scenario.',
    );
  }
  const flagged = suspiciousPassageIds(
    documents.flatMap((document) =>
      document.excerpt ? [{ id: plainName(document.name, 60), text: document.excerpt }] : [],
    ),
  );
  if (flagged.length > 0) {
    const shown = flagged.slice(0, 5).join(', ');
    const more = flagged.length > 5 ? ` and ${flagged.length - 5} more` : '';
    notes.push(
      `${flagged.length === 1 ? 'The document' : 'The documents'} ${shown}${more} contain${flagged.length === 1 ? 's' : ''} text that reads as an instruction to an AI model. It is treated as data and never followed; review the source before relying on the results.`,
    );
  }
  return notes;
}

/**
 * Turns a what-if question into a scenario frame. A model reads it when one is given and its reply
 * passes the checks; in every other case the rules read it, and the notes say which it was and why.
 * It does not run anything and it does not store anything.
 */
export async function parseScenario(input: ParseInput): Promise<ScenarioParseResult> {
  const documents = input.documents ?? [];
  const signal = input.signal ?? new AbortController().signal;
  const notes = injectionNotes(input.question, documents);
  if (input.model) {
    try {
      const frame = await readByModel({
        question: input.question,
        documents,
        model: input.model,
        signal,
      });
      return {
        frame,
        notes: [...notes, MODEL_NOTE],
        mode: 'model',
        model: input.modelName ?? null,
      };
    } catch (error) {
      // Someone who has gone away is not owed a second reading.
      if (signal.aborted) throw error;
      notes.push(failureNote(error));
    }
  }
  const reading = readByRules({ question: input.question, documents });
  return {
    frame: reading.frame,
    notes: [...notes, RULES_NOTE, ...reading.notes],
    mode: 'rules',
    model: null,
  };
}
