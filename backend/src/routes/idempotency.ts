import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

/** A client-chosen key that makes a repeated request one job: letters, digits and `-_.:` only. */
const keySchema = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{8,128}$/u)
  .optional();

/**
 * The `Idempotency-Key` header of a request, as options for queuing a job. A client that retries
 * after a lost reply sends the same key, and gets the job it already made, not a second one.
 */
export function idempotencyOptions(request: FastifyRequest): { idempotencyKey?: string } {
  const key = keySchema.parse(request.headers['idempotency-key']);
  return key === undefined ? {} : { idempotencyKey: key };
}
