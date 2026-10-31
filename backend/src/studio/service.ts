import { randomUUID } from 'node:crypto';
import { isOpenConflict, type ClaimRecord } from '../../../shared/evidence.js';
import type { SimulationMemory } from '../../../shared/guided.js';
import {
  MAX_INSTRUCTION,
  MAX_NOTE,
  MAX_SECTION_BODY,
  MAX_VERSIONS_PER_SECTION,
  type EditSectionInput,
  type StartStudioInput,
  type StudioCapabilities,
  type StudioDocument,
  type StudioProposal,
  type StudioSectionView,
  type StudioView,
  type TransitionInput,
} from '../../../shared/studio.js';
import type { EvidenceChunk, ProjectDetail } from '../../../shared/types.js';
import { AppError } from '../errors.js';
import { LedgerService, deriveScenarioAssumptions } from '../grounding/service.js';
import type { AuditDetail } from '../storage/audit.js';
import type { Repository } from '../storage/repository.js';
import * as rules from './model.js';
import type { SectionRegenerator } from './regenerate.js';

const MAX_ATTEMPTS = 4;

interface Audited {
  action: string;
  detail?: AuditDetail;
}

/** Why a section cannot be written again by the model, or null when it can. */
const NOT_A_CHAPTER = 'Only a chapter can be regenerated, one at a time.';

/** The value without the named keys, as a new object. */
function omit<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  const copy: Partial<T> = { ...value };
  for (const key of keys) delete copy[key];
  return copy as Omit<T, K>;
}

/**
 * Owns Report Studio: opens a document from a generated report, applies a person's changes under the
 * rules in `model.ts`, saves them with the revision they started from, and records each in the audit
 * log in the same transaction. A change that loses a race with another person is applied again to
 * what they saved, and is refused only if it no longer makes sense there.
 */
export class StudioService {
  private readonly running = new Set<string>();

  constructor(
    private readonly repository: Repository,
    private readonly ledger: LedgerService,
    private readonly regenerator: SectionRegenerator | null = null,
    private readonly options: {
      clock?: () => Date;
      newId?: () => string;
      /** True while a stage of the project is running, which may be about to replace its report. */
      isBusy?: (projectId: string) => boolean;
    } = {},
  ) {}

  private now(): Date {
    return (this.options.clock ?? (() => new Date()))();
  }

  private id(): string {
    return (this.options.newId ?? randomUUID)();
  }

  // ---- Reading

  /** A report is ready to open once the project is complete and has one. */
  private reportOf(project: ProjectDetail): NonNullable<ProjectDetail['report']> | null {
    return project.status === 'completed' && project.report ? project.report : null;
  }

  private isStale(project: ProjectDetail, doc: StudioDocument): boolean {
    return !project.report || doc.baseHash !== rules.reportHash(project.report);
  }

  /** What the studio shows for a project: the document, and what a person needs to judge it. */
  view(projectId: string, capabilities: StudioCapabilities): StudioView {
    const project = this.repository.get(projectId);
    const report = this.reportOf(project);
    const doc = this.repository.studio.get(projectId);
    const regeneration = this.regenerator?.availability(project) ?? {
      available: false,
      reason: 'Regeneration is not set up on this server.',
    };
    const limits = {
      maxBody: MAX_SECTION_BODY,
      maxNote: MAX_NOTE,
      maxVersions: MAX_VERSIONS_PER_SECTION,
      maxInstruction: MAX_INSTRUCTION,
    };
    const header = report
      ? { title: report.title, question: project.question, engine: project.mode }
      : null;
    if (!doc) {
      return {
        document: null,
        stale: false,
        reportReady: report !== null,
        capabilities,
        regeneration,
        passages: [],
        memories: [],
        assumptions: [],
        conflicts: [],
        report: header,
        limits,
      };
    }
    const ledger = report ? this.ledger.get(projectId) : null;
    const ledgerStatements = (title: string): ClaimRecord[] =>
      (ledger?.claims ?? []).filter(
        (claim) => claim.section === title && claim.generationStage === 'report',
      );
    const sections: StudioSectionView[] = doc.sections.map((section) => {
      const current = rules.checkedFor(section);
      // A section edited since its statements were checked still shows the last ones, marked as
      // describing an earlier text, so a person can see what was and was not checked.
      const shown = current ?? section.checked.at(-1);
      const statements = !shown
        ? []
        : shown.from === 'ledger'
          ? ledgerStatements(section.title)
          : shown.statements;
      const rest = omit(section, 'checked');
      return {
        ...rest,
        statements,
        statementsCurrent: current !== undefined,
        grounding: current?.grounding ?? null,
        proposal: doc.proposals.find((proposal) => proposal.sectionId === section.id) ?? null,
      };
    });
    const everyStatement = [
      ...sections.flatMap((section) => section.statements),
      ...sections.flatMap((section) => section.proposal?.statements ?? []),
    ];
    const passageIds = new Set(
      everyStatement.flatMap((claim) =>
        [...claim.supporting, ...claim.contradicting].map((ref) => ref.passageId),
      ),
    );
    const memoryIds = new Set(
      everyStatement.flatMap((claim) => claim.simulationEvents.map((event) => event.memoryId)),
    );
    const passages: EvidenceChunk[] = passageIds.size
      ? this.repository.chunks(projectId).filter((chunk) => passageIds.has(chunk.id))
      : [];
    const memories: SimulationMemory[] = memoryIds.size
      ? (project.console?.memories ?? []).filter((memory) => memoryIds.has(memory.id))
      : [];
    const rest = omit(doc, 'proposals', 'sections');
    return {
      document: { ...rest, sections },
      stale: this.isStale(project, doc),
      reportReady: report !== null,
      capabilities,
      regeneration,
      passages,
      memories,
      assumptions: deriveScenarioAssumptions(project),
      conflicts: (ledger?.contradictions ?? []).filter((conflict) =>
        isOpenConflict(conflict.status),
      ),
      report: header,
      limits,
    };
  }

  /** The stored document and the project it is about, for an export. No staleness check: a person may always take their work out. */
  stored(projectId: string): { project: ProjectDetail; doc: StudioDocument; stale: boolean } {
    const project = this.repository.get(projectId);
    const doc = this.repository.studio.get(projectId);
    if (!doc) {
      throw new AppError(
        409,
        'STUDIO_NOT_STARTED',
        'Nobody has opened this report in the studio yet.',
      );
    }
    return { project, doc, stale: this.isStale(project, doc) };
  }

  // ---- Starting

  /**
   * Opens the report in the studio, or, when the generated report has been replaced since, starts a
   * new document from the newer one (keeping the old text in its archive; `confirm` says a person
   * who worked on it knows).
   */
  start(projectId: string, input: StartStudioInput, actor: string): StudioDocument {
    const project = this.repository.get(projectId);
    const report = this.reportOf(project);
    if (!report) {
      throw new AppError(
        409,
        'REPORT_NOT_READY',
        'Complete the experiment and its report before opening it in the studio.',
      );
    }
    const now = this.now();
    const existing = this.repository.studio.get(projectId);
    if (!existing) {
      const fresh = rules.startDocument(report, actor, now.toISOString());
      let inserted = false;
      this.repository.atomic(() => {
        inserted = this.repository.studio.insert(projectId, fresh);
        if (inserted) this.record(projectId, actor, now, { action: 'studio.started' }, fresh);
      });
      if (!inserted) {
        throw new AppError(
          409,
          'STUDIO_EXISTS',
          'Someone else just opened this report. Reload it.',
        );
      }
      return fresh;
    }
    const next = rules.restartDocument(existing, report, actor, now.toISOString(), input.confirm);
    let saved = false;
    this.repository.atomic(() => {
      saved = this.repository.studio.save(projectId, next, existing.revision);
      if (saved) {
        this.record(
          projectId,
          actor,
          now,
          { action: 'studio.restarted', detail: { archived: next.archive.length } },
          next,
        );
      }
    });
    if (!saved) {
      throw new AppError(
        409,
        'STUDIO_CHANGED',
        'The report changed while you were restarting it. Reload it and look again.',
      );
    }
    return next;
  }

  // ---- Changing

  private record(
    projectId: string,
    actor: string,
    at: Date,
    audited: Audited,
    doc: StudioDocument,
  ): void {
    this.repository.audit.record(
      {
        actor,
        action: audited.action,
        targetType: 'studio',
        targetId: projectId,
        projectId,
        detail: { revision: doc.revision, state: doc.state, ...audited.detail },
      },
      at,
    );
  }

  /** The document, for a change: it must exist, and be made from the report the project has now. */
  private open(projectId: string): StudioDocument {
    const project = this.repository.get(projectId);
    const doc = this.repository.studio.get(projectId);
    if (!doc) {
      throw new AppError(
        409,
        'STUDIO_NOT_STARTED',
        'Open the report in the studio before changing it.',
      );
    }
    if (this.isStale(project, doc)) {
      throw new AppError(
        409,
        'STUDIO_STALE',
        'The generated report was replaced after this document was made. Start again from the newer report; this one keeps its text in the archive.',
      );
    }
    return doc;
  }

  /**
   * Applies a change to the latest saved document. If someone saves first, it is applied again to
   * what they saved: two people editing different sections both succeed, and two editing the same
   * one do not, because the second is refused by its version.
   */
  private change(
    projectId: string,
    actor: string,
    apply: (doc: StudioDocument, now: string) => StudioDocument,
    audited: (before: StudioDocument, after: StudioDocument) => Audited,
  ): StudioDocument {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const before = this.open(projectId);
      const now = this.now();
      const after = apply(before, now.toISOString());
      let saved = false;
      this.repository.atomic(() => {
        // The operation can run again on a shared database, so it starts from zero.
        saved = this.repository.studio.save(projectId, after, before.revision);
        if (saved) this.record(projectId, actor, now, audited(before, after), after);
      });
      if (saved) return after;
    }
    throw new AppError(
      409,
      'STUDIO_BUSY',
      'Several people are changing this report at once. Try again in a moment.',
    );
  }

  editSection(
    projectId: string,
    sectionId: string,
    input: EditSectionInput,
    actor: string,
  ): StudioDocument {
    return this.change(
      projectId,
      actor,
      (doc, now) => rules.editSection(doc, sectionId, input, actor, now),
      (_before, after) => ({
        action: 'studio.section.edited',
        detail: {
          section: sectionId,
          version: rules.findSection(after, sectionId).version,
          chars: rules.findSection(after, sectionId).body.length,
          reasonChars: input.reason?.length ?? 0,
        },
      }),
    );
  }

  setLock(projectId: string, sectionId: string, locked: boolean, actor: string): StudioDocument {
    return this.change(
      projectId,
      actor,
      (doc, now) => rules.setLock(doc, sectionId, locked, actor, now),
      () => ({
        action: locked ? 'studio.section.locked' : 'studio.section.unlocked',
        detail: { section: sectionId },
      }),
    );
  }

  addNote(projectId: string, sectionId: string, text: string, actor: string): StudioDocument {
    return this.change(
      projectId,
      actor,
      (doc, now) => rules.addNote(doc, sectionId, text, actor, now, this.id()),
      () => ({ action: 'studio.note.added', detail: { section: sectionId, chars: text.length } }),
    );
  }

  restoreVersion(
    projectId: string,
    sectionId: string,
    input: { version: number; expectedVersion: number; reason: string | null },
    actor: string,
  ): StudioDocument {
    return this.change(
      projectId,
      actor,
      (doc, now) => rules.restoreVersion(doc, sectionId, input, actor, now),
      (_before, after) => ({
        action: 'studio.section.restored',
        detail: {
          section: sectionId,
          from: input.version,
          version: rules.findSection(after, sectionId).version,
        },
      }),
    );
  }

  decideProposal(
    projectId: string,
    sectionId: string,
    input: { decision: 'accept' | 'reject'; proposalId: string; expectedVersion: number },
    actor: string,
  ): StudioDocument {
    return this.change(
      projectId,
      actor,
      (doc, now) => rules.decideProposal(doc, sectionId, input, actor, now),
      (_before, after) => ({
        action:
          input.decision === 'accept' ? 'studio.proposal.accepted' : 'studio.proposal.rejected',
        detail: { section: sectionId, version: rules.findSection(after, sectionId).version },
      }),
    );
  }

  transition(
    projectId: string,
    kind: rules.Transition,
    input: TransitionInput,
    actor: string,
  ): StudioDocument {
    const action: Record<rules.Transition, string> = {
      submit: 'studio.submitted',
      approve: 'studio.approved',
      'request-changes': 'studio.changes.requested',
      reopen: 'studio.reopened',
    };
    return this.change(
      projectId,
      actor,
      (doc, now) => rules.transition(doc, kind, input, actor, now),
      (_before, after) => ({
        action: action[kind],
        detail: {
          noteChars: input.note?.length ?? 0,
          ...(kind === 'approve' ? { alsoEdited: after.approval?.alsoEdited ?? false } : {}),
        },
      }),
    );
  }

  // ---- Regenerating a section

  /**
   * Asks the model to write one chapter again from the same sources, checks what it wrote the way the
   * report was checked, and puts it in front of a person as a proposal. Nothing in the document changes
   * until they accept it. One regeneration runs per report at a time.
   */
  async regenerate(
    projectId: string,
    sectionId: string,
    input: { expectedVersion: number; instruction: string | null },
    actor: string,
    signal: AbortSignal,
  ): Promise<StudioDocument> {
    const regenerator = this.regenerator;
    const project = this.repository.get(projectId);
    const availability = regenerator?.availability(project);
    if (!regenerator || !availability?.available) {
      throw new AppError(
        409,
        'REGENERATION_UNAVAILABLE',
        availability?.reason ?? 'Regeneration is not set up on this server.',
      );
    }
    if (this.running.has(projectId) || this.options.isBusy?.(projectId)) {
      throw new AppError(
        409,
        'PROJECT_BUSY',
        'Wait for the work already running on this experiment to finish.',
      );
    }
    const doc = this.open(projectId);
    rules.assertEditable(doc);
    const section = rules.findSection(doc, sectionId);
    if (section.kind !== 'chapter') throw new AppError(400, 'NOT_REGENERABLE', NOT_A_CHAPTER);
    if (section.locked) {
      throw new AppError(409, 'SECTION_LOCKED', 'This section is locked. Unlock it to change it.');
    }
    if (doc.proposals.some((proposal) => proposal.sectionId === sectionId)) {
      throw new AppError(
        409,
        'PROPOSAL_PENDING',
        'Accept or reject the regenerated text for this section first.',
      );
    }
    if (section.version !== input.expectedVersion) {
      throw new AppError(
        409,
        'SECTION_CONFLICT',
        'Someone else changed this section. Reload it, then ask again.',
      );
    }
    this.running.add(projectId);
    try {
      const result = await regenerator.run({
        project,
        section,
        instruction: input.instruction,
        signal,
        nextStatement: nextStatementNumber(doc),
      });
      const proposal: StudioProposal = {
        id: this.id(),
        sectionId,
        baseVersion: section.version,
        body: result.body,
        statements: result.statements,
        grounding: result.grounding,
        instruction: input.instruction,
        actor,
        at: this.now().toISOString(),
        usage: result.usage,
      };
      return this.change(
        projectId,
        actor,
        (current, now) => rules.addProposal(current, proposal, now),
        () => ({
          action: 'studio.regeneration.proposed',
          detail: {
            section: sectionId,
            modelCalls: result.usage.modelCalls,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            statements: result.statements.length,
          },
        }),
      );
    } finally {
      this.running.delete(projectId);
    }
  }
}

/** Statement identifiers of regenerated text are `G1`, `G2`, ...: apart from the ledger's `C1`, and unique within the document. */
export function nextStatementNumber(doc: StudioDocument): number {
  let highest = 0;
  const note = (id: string): void => {
    const match = /^G(\d+)$/u.exec(id);
    if (match) highest = Math.max(highest, Number(match[1]));
  };
  for (const section of doc.sections) {
    for (const entry of section.checked)
      entry.statements.forEach((statement) => note(statement.id));
  }
  for (const proposal of doc.proposals)
    proposal.statements.forEach((statement) => note(statement.id));
  return highest + 1;
}
