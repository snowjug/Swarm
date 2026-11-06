import type { z } from 'zod';
import type { AppError } from '../errors.js';
import type { JsonOptions, ModelGateway } from './client.js';
import type { ModelRole } from './task.js';

/** A gateway that makes no call: every use of it is refused with `error`, in words for a person. */
export function refusingGateway(error: AppError): ModelGateway {
  return {
    json<T>(): Promise<T> {
      return Promise.reject(error);
    },
  };
}

/**
 * The same gateway, with the error of a failed call replaced by `reword(error)`. For a funding whose provider speaks
 * of itself differently (a person's own key: a block is Google's, not "the deployment's content filter"). It changes how
 * a failure reads and never whether there is one.
 */
export function rewordedGateway(
  inner: ModelGateway,
  reword: (error: unknown) => unknown,
): ModelGateway {
  return {
    ...(inner.provider ? { provider: inner.provider } : {}),
    async json<T>(
      schema: z.ZodType<T>,
      instructions: string,
      data: unknown,
      signal: AbortSignal,
      maxTokens?: number,
      options?: JsonOptions<T>,
    ): Promise<T> {
      try {
        return await inner.json(schema, instructions, data, signal, maxTokens, options);
      } catch (error) {
        throw reword(error);
      }
    },
  };
}

/**
 * The same gateway, held to at most `cap(role)` output tokens a call. The router passes the role of every task with its
 * call, and a call that names none is held to what `cap(null)` says. It only ever lowers a limit.
 */
export function cappedGateway(
  inner: ModelGateway,
  cap: (role: ModelRole | null) => number,
): ModelGateway {
  return {
    ...(inner.provider ? { provider: inner.provider } : {}),
    json<T>(
      schema: z.ZodType<T>,
      instructions: string,
      data: unknown,
      signal: AbortSignal,
      maxTokens?: number,
      options?: JsonOptions<T>,
    ): Promise<T> {
      const limit = cap(options?.route?.role ?? null);
      return inner.json(
        schema,
        instructions,
        data,
        signal,
        maxTokens === undefined ? limit : Math.min(maxTokens, limit),
        options,
      );
    },
  };
}
