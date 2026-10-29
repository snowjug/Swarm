import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { emptyConsole } from '../../../shared/guided.js';
import {
  MAX_PROJECTS,
  type ChatMessage,
  type EvidenceChunk,
  type ProjectDetail,
  type ProjectSummary,
  type Stage,
  type ValidatedProjectInput,
} from '../../../shared/types.js';
import { AppError } from '../errors.js';
import { hashText } from '../grounding/ledger.js';
import { readCheckpoint } from '../guided/checkpoint.js';
import { PARSER_VERSION, chunkDocuments } from '../knowledge/retrieval.js';
import { AuditLog } from './audit.js';
import {
  chatMessageSchema,
  chunkSchema,
  decode,
  eventSchema,
  storedProjectSchema,
  type StoredProject,
} from './codec.js';
import { LedgerStore } from './ledger-store.js';
import {
  LATEST_SCHEMA_VERSION,
  migrate,
  readSchemaVersion,
  type MigrationReport,
} from './migrations.js';

const payloadRow = z.object({ payload: z.string() });
const countRow = z.object({ count: z.number() });
const ownerRow = z.object({ tenant_id: z.string(), owner_id: z.string() });

/** Who a project belongs to. The tenant is the workspace boundary; the owner may change it. */
export interface Owner {
  tenantId: string;
  ownerId: string;
}

/** Without sign-in, everything belongs to the one local user. */
export const LOCAL_OWNER: Owner = { tenantId: 'local', ownerId: 'local-user' };

export class Repository {
  private readonly database: DatabaseSync;
  /** Claim records and conflicts between sources. */
  readonly ledger: LedgerStore;
  /** Append-only record of who did what. Holds identifiers and counts, never content. */
  readonly audit: AuditLog;
  /** What the schema migration did when this database was opened. */
  readonly migration: MigrationReport;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(path);
    if (readSchemaVersion(this.database) > LATEST_SCHEMA_VERSION) {
      this.database.close();
      throw new AppError(
        500,
        'STORAGE_VERSION',
        'This database requires a newer application version.',
      );
    }
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
    `);
    try {
      this.migration = migrate(this.database, { path });
    } catch (error) {
      this.database.close();
      throw error;
    }
    this.ledger = new LedgerStore(this.database, (operation) => this.transaction(operation));
    this.audit = new AuditLog(this.database);
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  /** Runs several changes as one unit: all of them are saved, or none. Not re-entrant. */
  atomic<T>(operation: () => T): T {
    return this.transaction(operation);
  }

  private readStored(id: string): StoredProject | undefined {
    const row = this.database.prepare('SELECT payload FROM projects WHERE id = ?').get(id);
    return row ? decode(storedProjectSchema, payloadRow.parse(row).payload) : undefined;
  }

  get(id: string): ProjectDetail {
    const project = this.readStored(id);
    if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'This experiment does not exist.');
    const events = this.database
      .prepare(
        `SELECT id, project_id AS projectId, stage, message, created_at AS createdAt
         FROM events WHERE project_id = ? ORDER BY id DESC LIMIT 100`,
      )
      .all(id)
      .map((row) => eventSchema.parse(row))
      .reverse();
    return { ...project, events, parentId: project.console?.branch?.parentId ?? null };
  }

  /** All experiments, or only those of one tenant. */
  count(tenantId?: string): number {
    const row =
      tenantId === undefined
        ? this.database.prepare('SELECT COUNT(*) AS count FROM projects').get()
        : this.database
            .prepare('SELECT COUNT(*) AS count FROM projects WHERE tenant_id = ?')
            .get(tenantId);
    return countRow.parse(row).count;
  }

  /** Who an experiment belongs to, or null when there is no such experiment. */
  ownership(id: string): Owner | null {
    const row = this.database
      .prepare('SELECT tenant_id, owner_id FROM projects WHERE id = ?')
      .get(id);
    if (!row) return null;
    const parsed = ownerRow.parse(row);
    return { tenantId: parsed.tenant_id, ownerId: parsed.owner_id };
  }

  list(limit = 100, offset = 0, tenantId?: string): { projects: ProjectSummary[]; total: number } {
    const rows =
      tenantId === undefined
        ? this.database
            .prepare('SELECT payload FROM projects ORDER BY created_at DESC, id LIMIT ? OFFSET ?')
            .all(limit, offset)
        : this.database
            .prepare(
              'SELECT payload FROM projects WHERE tenant_id = ? ORDER BY created_at DESC, id LIMIT ? OFFSET ?',
            )
            .all(tenantId, limit, offset);
    const projects = rows.map((row): ProjectSummary => {
      const project = decode(storedProjectSchema, payloadRow.parse(row).payload);
      const {
        id,
        name,
        workflow,
        question,
        status,
        stage,
        progress,
        mode,
        agentCount,
        roundCount,
        currentRound,
        createdAt,
        updatedAt,
        error,
      } = project;
      return {
        id,
        name,
        workflow,
        question,
        status,
        stage,
        progress,
        mode,
        agentCount,
        roundCount,
        currentRound,
        createdAt,
        updatedAt,
        error,
        parentId: project.console?.branch?.parentId ?? null,
      };
    });
    return { projects, total: this.count(tenantId) };
  }

  create(
    input: ValidatedProjectInput,
    options: { inheritChunksFrom?: string; owner?: Owner } = {},
  ): ProjectDetail {
    const owner = options.owner ?? LOCAL_OWNER;
    // The limit is per tenant, so one organisation cannot use up another's allowance.
    if (this.count(owner.tenantId) >= MAX_PROJECTS) {
      throw new AppError(
        409,
        'PROJECT_LIMIT',
        `Keep at most ${MAX_PROJECTS} experiments. Export/delete an old one first.`,
      );
    }
    const now = new Date().toISOString();
    const project: StoredProject = {
      id: randomUUID(),
      name: input.name,
      workflow: input.workflow,
      question: input.question,
      status: 'draft',
      stage: 'intake',
      progress: 0,
      mode: input.settings.mode,
      agentCount: input.settings.agentCount,
      roundCount: input.settings.rounds,
      currentRound: 0,
      createdAt: now,
      updatedAt: now,
      error: null,
      settings: input.settings,
      documents: input.documents.map((document, index) => ({ ...document, id: `D${index + 1}` })),
      graph: null,
      agents: [],
      rounds: [],
      report: null,
      execution: null,
      console: input.workflow === 'guided' ? emptyConsole() : null,
    };
    this.transaction(() => {
      this.database
        .prepare(
          'INSERT INTO projects (id, created_at, updated_at, status, payload, tenant_id, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          project.id,
          now,
          now,
          project.status,
          JSON.stringify(project),
          owner.tenantId,
          owner.ownerId,
        );
      const insert = this.database.prepare(
        'INSERT INTO chunks (project_id, id, payload) VALUES (?, ?, ?)',
      );
      // A branch keeps the passages its parent was built from, with their original provenance:
      // the sources did not change, so neither does when or how they were cut.
      const inherited = options.inheritChunksFrom ? this.chunks(options.inheritChunksFrom) : null;
      const passages: EvidenceChunk[] =
        inherited ??
        chunkDocuments(project.documents).map((chunk) => ({
          ...chunk,
          // Each passage records where it came from and what it said when it was cut.
          contentHash: hashText(chunk.text),
          extractedAt: now,
          parserVersion: PARSER_VERSION,
          reviewStatus: 'unreviewed',
        }));
      for (const passage of passages) {
        insert.run(project.id, passage.id, JSON.stringify(passage));
      }
      this.addEvent(
        project.id,
        'intake',
        `${project.documents.length} source document(s) validated and indexed locally.`,
      );
    });
    return this.get(project.id);
  }

  update(
    id: string,
    changes: Partial<Omit<StoredProject, 'id' | 'createdAt' | 'updatedAt'>>,
  ): ProjectDetail {
    const current = this.readStored(id);
    if (!current) throw new AppError(404, 'PROJECT_NOT_FOUND', 'This experiment does not exist.');
    const next: StoredProject = { ...current, ...changes, updatedAt: new Date().toISOString() };
    storedProjectSchema.parse(next);
    this.database
      .prepare('UPDATE projects SET updated_at = ?, status = ?, payload = ? WHERE id = ?')
      .run(next.updatedAt, next.status, JSON.stringify(next), id);
    return this.get(id);
  }

  addEvent(projectId: string, stage: Stage, message: string): void {
    this.database
      .prepare('INSERT INTO events (project_id, stage, message, created_at) VALUES (?, ?, ?, ?)')
      .run(projectId, stage, message, new Date().toISOString());
  }

  chunks(projectId: string): EvidenceChunk[] {
    this.get(projectId);
    return this.database
      .prepare(
        'SELECT payload FROM chunks WHERE project_id = ? ORDER BY CAST(SUBSTR(id, 2) AS INTEGER)',
      )
      .all(projectId)
      .map((row) => decode(chunkSchema, payloadRow.parse(row).payload));
  }

  conversation(projectId: string, target: string): ChatMessage[] {
    this.get(projectId);
    return this.database
      .prepare('SELECT payload FROM messages WHERE project_id = ? AND target = ? ORDER BY seq')
      .all(projectId, target)
      .map((row) => decode(chatMessageSchema, payloadRow.parse(row).payload));
  }

  allMessages(projectId: string): ChatMessage[] {
    this.get(projectId);
    return this.database
      .prepare('SELECT payload FROM messages WHERE project_id = ? ORDER BY seq')
      .all(projectId)
      .map((row) => decode(chatMessageSchema, payloadRow.parse(row).payload));
  }

  messageCount(projectId: string): number {
    return countRow.parse(
      this.database
        .prepare('SELECT COUNT(*) AS count FROM messages WHERE project_id = ?')
        .get(projectId),
    ).count;
  }

  appendMessages(projectId: string, messages: ChatMessage[]): void {
    this.transaction(() => {
      if (this.messageCount(projectId) + messages.length > 60) {
        throw new AppError(
          409,
          'CONVERSATION_LIMIT',
          'This experiment is limited to 30 follow-up exchanges.',
        );
      }
      const insert = this.database.prepare(
        'INSERT INTO messages (id, project_id, target, payload) VALUES (?, ?, ?, ?)',
      );
      for (const message of messages) {
        insert.run(message.id, projectId, message.target, JSON.stringify(message));
      }
    });
  }

  recordUsage(projectId: string, inputTokens: number, outputTokens: number): void {
    const execution = this.get(projectId).execution;
    if (!execution)
      throw new Error('Model usage cannot be recorded before execution metadata exists.');
    this.update(projectId, {
      execution: {
        ...execution,
        modelCalls: execution.modelCalls + 1,
        inputTokens: execution.inputTokens + inputTokens,
        outputTokens: execution.outputTokens + outputTokens,
      },
    });
  }

  recoverInterrupted(): void {
    for (const summary of this.list().projects) {
      const project = this.get(summary.id);
      const interrupted = project.status === 'queued' || project.status === 'running';
      const surveyInterrupted = project.console?.surveys.some(
        (survey) => survey.status === 'queued' || survey.status === 'running',
      );
      if (!interrupted && !surveyInterrupted) continue;
      const saved = readCheckpoint(project);
      const error =
        saved === null
          ? 'The backend restarted before this run finished. Retry to start a new attempt.'
          : `The backend restarted before this run finished. Rounds 1-${saved} are saved; resume from round ${saved + 1} or restart.`;
      const consoleState = project.console;
      if (consoleState) {
        const steps = { ...consoleState.steps };
        for (const step of [
          'knowledge',
          'environment',
          'simulation',
          'report',
          'interaction',
        ] as const) {
          if (steps[step] === 'queued' || steps[step] === 'running') steps[step] = 'failed';
        }
        this.update(project.id, {
          console: {
            ...consoleState,
            steps,
            platforms: consoleState.platforms.map((run) => ({
              ...run,
              status: run.status === 'running' ? 'failed' : run.status,
            })),
            traces: consoleState.traces.map((trace) =>
              trace.status === 'running'
                ? { ...trace, status: 'failed', completedAt: new Date().toISOString(), error }
                : trace,
            ),
            surveys: consoleState.surveys.map((survey) =>
              survey.status === 'queued' || survey.status === 'running'
                ? {
                    ...survey,
                    status: 'failed',
                    completedAt: new Date().toISOString(),
                    error:
                      'The backend restarted before this survey finished. Partial results are retained.',
                  }
                : survey,
            ),
          },
        });
      }
      if (interrupted) this.update(project.id, { status: 'failed', error });
      this.addEvent(project.id, project.stage, error);
    }
  }

  delete(id: string, actor = 'local-user'): void {
    const project = this.get(id);
    this.transaction(() => {
      this.database.prepare('DELETE FROM projects WHERE id = ?').run(id);
      // The log keeps who deleted what, never the content that was deleted.
      this.audit.record({
        actor,
        action: 'project.deleted',
        targetType: 'project',
        targetId: id,
        projectId: id,
        detail: { workflow: project.workflow, status: project.status },
      });
    });
  }

  close(): void {
    this.database.close();
  }
}
