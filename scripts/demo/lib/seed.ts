import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { DEMO_PROJECTS } from '../../../shared/demo.js';
import { AppError } from '../../../backend/src/errors.js';
import {
  LOCAL_OWNER,
  type Owner,
  type Repository,
} from '../../../backend/src/storage/repository.js';
import { parseSnapshot } from '../../../backend/src/storage/snapshot.js';

export const MANIFEST_FILE = 'manifest.json';

const manifestSchema = z.object({
  version: z.literal(1),
  recordedAt: z.string(),
  provider: z.string(),
  model: z.string().nullable(),
  projects: z
    .array(
      z.object({
        id: z.uuid(),
        slug: z.string(),
        // A plain file name: a manifest must not be able to point outside its own folder.
        file: z.string().regex(/^[a-z0-9][a-z0-9-]*\.json$/u),
      }),
    )
    .min(1),
});

export type SeedManifest = z.infer<typeof manifestSchema>;

export interface SeedOptions {
  directory: string;
  owner?: Owner;
  actor?: string;
  /** Validate everything and report what would change, without writing. */
  dryRun?: boolean;
}

export interface SeedLine {
  id: string;
  slug: string;
  outcome: 'restored' | 'replaced' | 'would restore' | 'would replace';
  status: string;
  messages: number;
}

/** Reads and checks the whole seed. Nothing is written until every file has passed. */
export function readSeed(directory: string): {
  manifest: SeedManifest;
  files: { id: string; slug: string; snapshot: unknown }[];
} {
  const manifest = manifestSchema.parse(
    JSON.parse(readFileSync(join(directory, MANIFEST_FILE), 'utf8')),
  );
  const expected = DEMO_PROJECTS.map((project) => `${project.id}:${project.slug}`);
  const actual = manifest.projects.map((entry) => `${entry.id}:${entry.slug}`);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(
      'The seed manifest does not list the demonstration projects in shared/demo.ts, in the same order.',
    );
  }
  const files = manifest.projects.map((entry) => {
    const snapshot: unknown = JSON.parse(readFileSync(join(directory, entry.file), 'utf8'));
    const project = parseSnapshot(snapshot).project;
    if (project.id !== entry.id) {
      throw new Error(`${entry.file} holds experiment ${project.id}, not ${entry.id}.`);
    }
    return { id: entry.id, slug: entry.slug, snapshot };
  });
  return { manifest, files };
}

/**
 * Restores the demonstration experiments. Only those identifiers are ever touched, so any other
 * experiment in the database is left exactly as it is. Running it again returns the demonstration
 * to its recorded state.
 */
export function seedDemo(repository: Repository, options: SeedOptions): SeedLine[] {
  const owner = options.owner ?? LOCAL_OWNER;
  const { files } = readSeed(options.directory);
  // Refuse before writing anything if one of them belongs to someone else.
  for (const { id } of files) {
    const existing = repository.ownership(id);
    if (existing && existing.tenantId !== owner.tenantId) {
      throw new AppError(
        409,
        'IMPORT_CONFLICT',
        `Experiment ${id} belongs to another workspace and will not be replaced.`,
      );
    }
  }
  return files.map(({ id, slug, snapshot }) => {
    const parsed = parseSnapshot(snapshot);
    const replacing = repository.ownership(id) !== null;
    const line = { id, slug, status: parsed.project.status, messages: parsed.messages.length };
    if (options.dryRun) {
      return { ...line, outcome: replacing ? 'would replace' : 'would restore' } as const;
    }
    const result = repository.importSnapshot(snapshot, {
      owner,
      ...(options.actor ? { actor: options.actor } : {}),
    });
    return { ...line, outcome: result.replaced ? 'replaced' : 'restored' } as const;
  });
}

/** Deletes the demonstration experiments of one workspace, and nothing else. */
export function removeDemo(
  repository: Repository,
  owner: Owner = LOCAL_OWNER,
  actor?: string,
): string[] {
  const removed: string[] = [];
  for (const { id } of [...DEMO_PROJECTS].reverse()) {
    const existing = repository.ownership(id);
    if (!existing || existing.tenantId !== owner.tenantId) continue;
    repository.delete(id, actor ?? owner.ownerId);
    removed.push(id);
  }
  return removed;
}
