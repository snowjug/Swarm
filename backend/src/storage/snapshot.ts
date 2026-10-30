import { z } from 'zod';
import type { ChatMessage, EvidenceChunk, JobEvent } from '../../../shared/types.js';
import { AppError } from '../errors.js';
import {
  chatMessageSchema,
  chunkSchema,
  eventSchema,
  storedProjectSchema,
  type StoredProject,
} from './codec.js';

/** The JSON export of a guided experiment, as `GET /api/projects/:id/export?format=json` writes it. */
const envelope = z.object({
  schemaVersion: z.literal(2),
  project: z.unknown(),
  evidence: z.array(chunkSchema),
  messages: z.array(chatMessageSchema),
});

export interface Snapshot {
  project: StoredProject;
  events: JobEvent[];
  evidence: EvidenceChunk[];
  messages: ChatMessage[];
}

const MAX_SNAPSHOT_MESSAGES = 60;

function invalid(reason: string): AppError {
  return new AppError(
    400,
    'SNAPSHOT_INVALID',
    `This is not an experiment this version can restore: ${reason}`,
  );
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue
    ? `${issue.path.join('.') || 'snapshot'}: ${issue.message}`.slice(0, 300)
    : 'unreadable';
}

/**
 * Checks an exported experiment against the same rules the repository applies to one it wrote
 * itself. Nothing is stored from a snapshot that fails any of them.
 */
export function parseSnapshot(raw: unknown): Snapshot {
  if (
    typeof raw !== 'object' ||
    raw === null ||
    (raw as { schemaVersion?: unknown }).schemaVersion !== 2
  ) {
    throw invalid('only a guided experiment exported as version 2 can be restored');
  }
  const parsed = envelope.safeParse(raw);
  if (!parsed.success) throw invalid(firstIssue(parsed.error));
  const project = storedProjectSchema.safeParse(parsed.data.project);
  if (!project.success) throw invalid(firstIssue(project.error));
  const events = z
    .object({ events: z.array(eventSchema).default([]) })
    .safeParse(parsed.data.project);
  if (!events.success) throw invalid(firstIssue(events.error));
  if (project.data.status === 'queued' || project.data.status === 'running') {
    throw invalid('it was exported while a run was in progress');
  }
  if (parsed.data.messages.length > MAX_SNAPSHOT_MESSAGES) {
    throw invalid(`it holds more than ${MAX_SNAPSHOT_MESSAGES} messages`);
  }
  const known = new Set(parsed.data.messages.map((message) => message.id));
  if (known.size !== parsed.data.messages.length) throw invalid('a message identifier repeats');
  return {
    project: project.data,
    events: events.data.events,
    evidence: parsed.data.evidence,
    messages: parsed.data.messages,
  };
}
