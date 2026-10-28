import type { z } from 'zod';
import type { ModelGateway } from './client.js';

/**
 * Asks the model for JSON and enforces `validate` on the result.
 *
 * The validator is handed to the gateway so a rejected reply can be repaired with a bounded
 * corrective retry, and it is applied again here so that no gateway implementation (a test double,
 * an alternative provider) can skip a server-side check by ignoring the hook. It must be idempotent.
 */
export async function jsonValidated<T>(
  model: ModelGateway,
  schema: z.ZodType<T>,
  instructions: string,
  data: unknown,
  signal: AbortSignal,
  maxTokens: number | undefined,
  validate: (value: T) => void,
  /** Corrective retries allowed for this call (the client caps it at three). */
  repairs?: number,
): Promise<T> {
  const value = await model.json(schema, instructions, data, signal, maxTokens, {
    validate,
    ...(repairs === undefined ? {} : { repairs }),
  });
  validate(value);
  return value;
}
