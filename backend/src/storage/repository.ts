import { randomUUID } from 'node:crypto';
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
import { MemberStore } from './members.js';
import { migrate, type MigrationReport } from './migrations.js';
import { openDatabase } from './open.js';
import { SessionStore } from './sessions.js';
import type { SqlDatabase } from './sql.js';
import { parseSnapshot } from './snapshot.js';

const payloadRow = z.object({ payload: z.string() });
const idRow = z.object({ id: z.string() });
const countRow = z.object({ count: z.number() });
const ownerRow = z.object({ tenant_id: z.string(), owner_id: z.string() });

/** Who a project belongs to. The tenant is the workspace boundary; the owner may change it. */
export interface Owner {
  tenantId: string;
  ownerId: string;
}

/** Without sign-in, everything belongs to the one local user. */
export const LOCAL_OWNER: Owner = { tenantId: 'local', ownerId: 'local-user' };

/**
 * Whose view a listing is. Someone who sees everything in their tenant (a workspace owner or admin,
 * or the one local user) gets all of it; anyone else gets only the projects they were added to.
 */
export interface Viewer {
  principalId: string;
  everything: boolean;
}

export class Repository {
  private readonly database: SqlDatabase;
  /** Claim records and conflicts between sources. */
  readonly ledger: LedgerStore;
  /** Append-only record of who did what. Holds identifiers and counts, never content. */
  readonly audit: AuditLog;
  /** Workspace and project membership: who may see and do what. */
  readonly members: MemberStore;
  /** Browser sign-in: logins in flight and the sessions they produced. */
  readonly sessions: SessionStore;
  /** What the schema migration did when this database was opened. */
  readonly migration: MigrationReport;

  /**
   * `target` is a SQLite file path, `:memory:`, or a `postgres://` URL (see `openDatabase`). With
   * `entra`, a PostgreSQL connection is authenticated with a Microsoft Entra access token instead of a password.
   */
  constructor(target: string, options: { now?: () => number; entra?: boolean } = {}) {
    this.database = openDatabase(
      target,
      options.entra === undefined ? {} : { entra: options.entra },
    );
    try {
      this.migration = migrate(this.database, { path: target });
    } catch (error) {
      this.database.close();
      throw error;
    }
    this.ledger = new LedgerStore(this.database, (operation) => this.transaction(operation));
    this.audit = new AuditLog(this.database);
    this.members = new MemberStore(
      this.database,
      (operation) => this.transaction(operation),
      this.audit,
    );
    this.sessions = new SessionStore(this.database, options.now);
  }

  /** Which database this is: `sqlite` or `postgres`. */
  get dialect(): SqlDatabase['dialect'] {
    return this.database.dialect;
  }

  /** True when the database connection is lost for good, so that only a restart will help. */
  get broken(): boolean {
    return this.database.broken;
  }

  /** Answers a trivial query, so that a probe can tell a live database from a dead one. */
  ping(): boolean {
    try {
      return this.database.prepare('SELECT 1 AS ok').get()?.ok === 1;
    } catch {
      return false;
    }
  }

  private transaction<T>(operation: () => T): T {
    return this.database.transaction(operation);
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

  /** All experiments, those of one tenant, or those of one tenant that a viewer may see. */
  count(tenantId?: string, viewer?: Viewer): number {
    if (tenantId !== undefined && viewer && !viewer.everything) {
      return countRow.parse(
        this.database
          .prepare(
            `SELECT COUNT(*) AS count FROM projects WHERE tenant_id = ?
             AND id IN (SELECT project_id FROM project_members WHERE principal_id = ?)`,
          )
          .get(tenantId, viewer.principalId),
      ).count;
    }
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

  list(
    limit = 100,
    offset = 0,
    tenantId?: string,
    viewer?: Viewer,
  ): { projects: ProjectSummary[]; total: number } {
    const restricted = tenantId !== undefined && viewer !== undefined && !viewer.everything;
    const rows = restricted
      ? this.database
          .prepare(
            `SELECT payload FROM projects WHERE tenant_id = ?
             AND id IN (SELECT project_id FROM project_members WHERE principal_id = ?)
             ORDER BY created_at DESC, id LIMIT ? OFFSET ?`,
          )
          .all(tenantId, viewer.principalId, limit, offset)
      : tenantId === undefined
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
    return { projects, total: this.count(tenantId, viewer) };
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
      this.members.insertLead(
        { id: project.id, tenantId: owner.tenantId },
        owner.ownerId,
        owner.ownerId,
        now,
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
      this.audit.record({
        actor: owner.ownerId,
        action: 'project.created',
        targetType: 'project',
        targetId: project.id,
        projectId: project.id,
        detail: {
          workflow: project.workflow,
          mode: project.mode,
          actors: project.agentCount,
          rounds: project.roundCount,
          documents: project.documents.length,
          branch: Boolean(options.inheritChunksFrom),
        },
      });
    });
    return this.get(project.id);
  }

  /**
   * Restores an exported experiment under its own identifier, replacing any earlier copy of it, so
   * that restoring the same snapshot twice leaves the same state. The ledger is not part of the
   * snapshot: it is derived from the report the first time it is read. Everything is written in one
   * transaction with the audit entry that records it.
   */
  importSnapshot(
    raw: unknown,
    options: { owner?: Owner; actor?: string } = {},
  ): { id: string; replaced: boolean } {
    const snapshot = parseSnapshot(raw);
    const owner = options.owner ?? LOCAL_OWNER;
    const { project } = snapshot;
    const existing = this.ownership(project.id);
    if (existing && existing.tenantId !== owner.tenantId) {
      throw new AppError(
        409,
        'IMPORT_CONFLICT',
        'An experiment with this identifier belongs to another workspace.',
      );
    }
    if (!existing && this.count(owner.tenantId) >= MAX_PROJECTS) {
      throw new AppError(
        409,
        'PROJECT_LIMIT',
        `Keep at most ${MAX_PROJECTS} experiments. Export/delete an old one first.`,
      );
    }
    this.transaction(() => {
      if (existing) this.database.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
      this.database
        .prepare(
          'INSERT INTO projects (id, created_at, updated_at, status, payload, tenant_id, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          project.id,
          project.createdAt,
          project.updatedAt,
          project.status,
          JSON.stringify(project),
          owner.tenantId,
          owner.ownerId,
        );
      this.members.insertLead(
        { id: project.id, tenantId: owner.tenantId },
        owner.ownerId,
        options.actor ?? owner.ownerId,
        project.createdAt,
      );
      const chunk = this.database.prepare(
        'INSERT INTO chunks (project_id, id, payload) VALUES (?, ?, ?)',
      );
      for (const passage of snapshot.evidence) {
        chunk.run(project.id, passage.id, JSON.stringify(passage));
      }
      const event = this.database.prepare(
        'INSERT INTO events (project_id, stage, message, created_at) VALUES (?, ?, ?, ?)',
      );
      for (const item of snapshot.events) {
        event.run(project.id, item.stage, item.message, item.createdAt);
      }
      const message = this.database.prepare(
        'INSERT INTO messages (id, project_id, target, payload) VALUES (?, ?, ?, ?)',
      );
      for (const item of snapshot.messages) {
        message.run(item.id, project.id, item.target, JSON.stringify(item));
      }
      this.audit.record({
        actor: options.actor ?? owner.ownerId,
        action: 'project.imported',
        targetType: 'project',
        targetId: project.id,
        projectId: project.id,
        detail: {
          replaced: Boolean(existing),
          status: project.status,
          passages: snapshot.evidence.length,
          messages: snapshot.messages.length,
        },
      });
    });
    return { id: project.id, replaced: Boolean(existing) };
  }

  update(
    id: string,
    changes: Partial<Omit<StoredProject, 'id' | 'createdAt' | 'updatedAt'>>,
  ): ProjectDetail {
    // Read and write as one step, so that a second writer on a shared database cannot be overwritten.
    const write = () => {
      const current = this.readStored(id);
      if (!current) {
        throw new AppError(404, 'PROJECT_NOT_FOUND', 'This experiment does not exist.');
      }
      const next: StoredProject = { ...current, ...changes, updatedAt: new Date().toISOString() };
      storedProjectSchema.parse(next);
      this.database
        .prepare('UPDATE projects SET updated_at = ?, status = ?, payload = ? WHERE id = ?')
        .run(next.updatedAt, next.status, JSON.stringify(next), id);
    };
    if (this.database.inTransaction) write();
    else this.transaction(write);
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
    // Every experiment of every tenant. The list is paged and newest first, and the limit on how
    // many one tenant may keep says nothing about how many the database holds, so a page would
    // leave an older run "running" for ever: it could not be deleted, cancelled or restarted.
    const ids = this.database
      .prepare('SELECT id FROM projects ORDER BY created_at, id')
      .all()
      .map((row) => idRow.parse(row).id);
    for (const id of ids) {
      const project = this.get(id);
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
