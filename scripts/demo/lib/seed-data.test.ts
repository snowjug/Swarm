import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEMO_PROJECTS } from '../../../shared/demo.js';
import { LedgerService } from '../../../backend/src/grounding/service.js';
import { ABSTENTION_MESSAGE } from '../../../backend/src/orchestration/evidence-gate.js';
import { Repository } from '../../../backend/src/storage/repository.js';
import { parseSnapshot } from '../../../backend/src/storage/snapshot.js';
import { STORY } from './record-flow.js';
import { MANIFEST_FILE, readSeed, seedDemo } from './seed.js';

// The committed recording is what the demonstration shows, so it is checked as data: it is valid,
// it keeps the contract it was recorded under, it was recorded with a real model, and it holds
// nothing that must not be published. The checks are on shape and on what is claimed, never on what
// the model happened to say, so a re-recording does not have to change them.
const DIRECTORY = 'docs/demo/seed';
const seed = readSeed(DIRECTORY);
const snapshots = seed.files.map((file) => parseSnapshot(file.snapshot));
const [base, guarantee, noNotice] = snapshots;

describe('the committed demonstration seed', () => {
  it('lists the three demonstration projects, each in a file of its own', () => {
    expect(seed.manifest.projects.map((entry) => entry.id)).toEqual(DEMO_PROJECTS.map((d) => d.id));
    expect(new Set(seed.manifest.projects.map((entry) => entry.file)).size).toBe(3);
    const present = readdirSync(DIRECTORY).filter((name) => name !== MANIFEST_FILE);
    expect(present.sort()).toEqual(seed.manifest.projects.map((entry) => entry.file).sort());
  });

  it('was recorded with a real model, and says which', () => {
    expect(seed.manifest.provider).toBe('azure');
    expect(seed.manifest.model).not.toBeNull();
    for (const { project } of snapshots) {
      expect(project.mode).toBe('llm');
      expect(project.execution).toMatchObject({ provider: seed.manifest.provider });
      expect(project.execution?.model).toBe(seed.manifest.model);
      expect(project.execution?.modelCalls).toBeGreaterThan(0);
    }
  });

  it('has a base run with at least three actors, several rounds, an intervention and a report', () => {
    expect(base!.project.status).toBe('completed');
    expect(base!.project.agents.length).toBeGreaterThanOrEqual(3);
    expect(base!.project.rounds.length).toBeGreaterThanOrEqual(3);
    expect(base!.project.settings.intervention).not.toBeNull();
    expect(base!.project.report).not.toBeNull();
    expect(base!.project.documents.length).toBeGreaterThanOrEqual(3);
    expect(
      new Set(base!.project.agents.map((agent) => Math.sign(agent.initialOpinion))).size,
    ).toBeGreaterThan(1);
  });

  it('has two branches of that run, both finished and both with a report of their own', () => {
    for (const branch of [guarantee!, noNotice!]) {
      expect(branch.project.status).toBe('completed');
      expect(branch.project.console?.branch?.parentId).toBe(DEMO_PROJECTS[0]!.id);
      expect(branch.project.console?.branch?.rootId).toBe(DEMO_PROJECTS[0]!.id);
      expect(branch.project.report).not.toBeNull();
    }
    expect(guarantee!.project.settings.intervention).not.toBeNull();
    expect(noNotice!.project.settings.intervention).toBeNull();
    // They share the base run's first rounds exactly, and then go their own way.
    for (const branch of [guarantee!, noNotice!]) {
      expect(branch.project.rounds.slice(0, STORY.branchFromRound)).toEqual(
        base!.project.rounds.slice(0, STORY.branchFromRound),
      );
    }
  });

  it('keeps a conversation with a cited answer, an abstention and an actor, and no more than it may hold', () => {
    const messages = base!.messages;
    expect(messages.length).toBeLessThanOrEqual(10);
    const replies = messages.filter((message) => message.role === 'assistant');
    expect(
      replies.some((reply) => reply.grounding?.status === 'cited' && reply.sourceIds.length > 0),
    ).toBe(true);
    const abstained = replies.filter((reply) => reply.grounding?.status === 'abstained');
    expect(abstained.length).toBeGreaterThanOrEqual(1);
    for (const reply of abstained) expect(reply.content.startsWith(ABSTENTION_MESSAGE)).toBe(true);
    expect(replies.some((reply) => reply.target !== 'report')).toBe(true);
    for (const branch of [guarantee!, noNotice!]) expect(branch.messages).toEqual([]);
  });

  it('builds a ledger with checked statements, a conflict between sources and stated assumptions', () => {
    const repository = new Repository(':memory:');
    seedDemo(repository, { directory: DIRECTORY });
    const ledger = new LedgerService(repository).get(DEMO_PROJECTS[0]!.id);
    expect(ledger.claims.length).toBeGreaterThan(0);
    expect(ledger.contradictions.length).toBeGreaterThan(0);
    expect(ledger.assumptions.length).toBeGreaterThan(0);
    repository.close();
  });

  it('is fictional and private-information free: no host, address, path, URL, token or account word', () => {
    const forbidden: [string, RegExp][] = [
      [
        'a cloud host',
        /[a-z0-9-]+\.(?:azure\.com|azure-api\.net|windows\.net|microsoft\.com|microsoftonline\.com|azurewebsites\.net|openai\.azure\.com)/iu,
      ],
      ['an email address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u],
      ['a local path', /[A-Za-z]:\\\\Users|\/Users\/|\/home\/|OneDrive|AppData/iu],
      ['a URL', /https?:\/\//iu],
      [
        'a token',
        /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.|\bsk-[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{16}|\bghp_[A-Za-z0-9]{30,}/u,
      ],
      [
        'an account word',
        /\b(?:tenant[_ -]?id|subscription[_ -]?id|client[_ -]?secret|bearer)\b/iu,
      ],
    ];
    for (const entry of readdirSync(DIRECTORY)) {
      const text = readFileSync(join(DIRECTORY, entry), 'utf8');
      for (const [label, pattern] of forbidden)
        expect(pattern.test(text), `${entry}: ${label}`).toBe(false);
    }
  });

  it('is small enough to keep in the repository and to read in one pass', () => {
    for (const entry of readdirSync(DIRECTORY)) {
      expect(readFileSync(join(DIRECTORY, entry)).length, entry).toBeLessThan(900_000);
    }
  });
});
