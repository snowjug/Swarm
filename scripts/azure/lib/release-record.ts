import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SmokeReport } from './pilot-smoke.js';

/**
 * The release record: what a release did, as JSON, written locally (by default into `.azure/releases/`,
 * which is not committed). It exists so that the next person, or the next release, can answer: which
 * commit and image digest is running, which revision was serving before it (the last known good), which
 * schema migrations came with it, what configuration it ran with, whether the smoke test passed, and
 * the exact commands that were run. It never holds a secret: environment values that could be one are
 * redacted, and a secret reference is recorded by name only.
 */

export const RECORD_SCHEMA_VERSION = 1;

export type ReleaseStatus =
  'dry-run' | 'in-progress' | 'canary' | 'promoted' | 'rolled-back' | 'failed' | 'finalized';

export interface EnvEntry {
  name: string;
  /** The value, unless it is redacted or a reference to a secret. */
  value?: string;
  redacted?: true;
  /** The name of a Container Apps secret (itself a Key Vault reference); never its value. */
  secretRef?: string;
}

export interface StepRecord {
  step: string;
  status: 'planned' | 'done' | 'failed' | 'skipped';
  /** The az arguments, which never contain a secret. */
  command?: string;
  at: string;
  detail?: string;
}

export interface RollbackEntry {
  at: string;
  to: string;
  basis: string;
  smokePassed: boolean;
  reason: string;
  /** True when the target had been deactivated, so the rollback started it rather than switching to a warm one. */
  cold: boolean;
}

export interface ReleaseRecord {
  schemaVersion: number;
  releaseId: string;
  /** Absent in records written before the tool could record a revision made by hand: those came from a release. */
  origin?: 'tool' | 'by-hand';
  status: ReleaseStatus;
  startedAt: string;
  finishedAt: string | null;
  target: { resourceGroup: string; app: string; registry: string };
  commit: { sha: string; shortSha: string };
  image: { reference: string; tag: string; digest: string; tagLocked: boolean };
  revision: { name: string; suffix: string; trafficWeight: number };
  /** The revision that served before: the one a rollback returns to. Null on a first release. */
  lastKnownGood: { revision: string; image: string; basis: string } | null;
  migrations: {
    schemaVersionBefore: number | null;
    schemaVersionAfter: number | null;
    applied: number[];
    acceptedSchemaChange: boolean;
    /** When a schema change is released, the time before it started: the point-in-time restore target. */
    restorePointUtc: string | null;
  };
  config: {
    cpu: string | number | null;
    memory: string | null;
    minReplicas: number | null;
    maxReplicas: number | null;
    environment: EnvEntry[];
  };
  smoke: {
    baseUrl: string;
    passed: boolean;
    checks: { id: string; status: string; detail: string }[];
  } | null;
  warmWindow: { hours: number; deactivateAfter: string } | null;
  steps: StepRecord[];
  rollbacks: RollbackEntry[];
  rollback: { command: string } | null;
}

/** Names whose value is never recorded, whatever it is. */
const SECRET_NAME =
  /KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|CONNECTION_STRING|AUTHENTICATION_STRING/iu;
/** Shapes that are credentials wherever they turn up in a value. */
const SECRET_VALUE = [
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/u,
  /\b(?:Bearer|Basic)\s+\S{8,}/iu,
  /[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/iu,
  /\b(?:AccountKey|SharedAccessKey|InstrumentationKey|Password|Pwd)=/iu,
  /[?&]sig=[A-Za-z0-9%+/=]{16,}/u,
];

export function redactEnvironment(
  env: readonly { name?: unknown; value?: unknown; secretRef?: unknown }[],
): EnvEntry[] {
  const entries: EnvEntry[] = [];
  for (const item of env) {
    const name = typeof item.name === 'string' ? item.name : '';
    if (!name) continue;
    if (typeof item.secretRef === 'string') {
      entries.push({ name, secretRef: item.secretRef });
    } else if (typeof item.value !== 'string') {
      entries.push({ name, value: '' });
    } else if (
      SECRET_NAME.test(name) ||
      SECRET_VALUE.some((shape) => shape.test(item.value as string))
    ) {
      entries.push({ name, redacted: true });
    } else {
      entries.push({ name, value: item.value });
    }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

export function releaseIdFor(now: Date, sha: string): string {
  return `${now
    .toISOString()
    .replace(/[-:]/gu, '')
    .replace(/\.\d+Z$/u, 'Z')}-${sha.slice(0, 12)}`;
}

/** The revision suffix for a commit: lower-case, starts with a letter, at most 20 characters. */
export function revisionSuffixFor(sha: string): string {
  return `r${sha.slice(0, 12).toLowerCase()}`;
}

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;

/**
 * A record that is still being made, or that ended before the image existed (a build that failed), has no
 * digest yet. Writing it down anyway is the point: the live pilot's first release left no trace because the
 * record was written only once the revision existed.
 */
const MAY_LACK_DIGEST: readonly ReleaseStatus[] = ['dry-run', 'in-progress', 'failed'];

/** A record that does not hold together is a bug in the tool, not something to write down. */
export function validateRecord(record: ReleaseRecord): string[] {
  const problems: string[] = [];
  if (record.schemaVersion !== RECORD_SCHEMA_VERSION) problems.push('schemaVersion');
  if (!SHA.test(record.commit.sha)) problems.push('commit.sha is not a full commit hash');
  const digestless = MAY_LACK_DIGEST.includes(record.status) && record.image.digest === '';
  if (!DIGEST.test(record.image.digest) && record.status !== 'dry-run' && !digestless)
    problems.push('image.digest is not a sha256 digest');
  if (record.image.tag !== `swarm:${record.commit.sha}`)
    problems.push('image.tag is not the commit hash');
  if (!record.image.reference.includes('@sha256:') && record.status !== 'dry-run' && !digestless) {
    problems.push('image.reference is not pinned by digest');
  }
  const text = JSON.stringify(record);
  for (const shape of SECRET_VALUE)
    if (shape.test(text)) problems.push('a credential-shaped value is in the record');
  for (const entry of record.config.environment) {
    if (entry.value !== undefined && SECRET_NAME.test(entry.name))
      problems.push(`${entry.name} has a value but its name says secret`);
  }
  return problems;
}

export function summariseSmoke(report: SmokeReport): NonNullable<ReleaseRecord['smoke']> {
  return {
    baseUrl: report.baseUrl,
    passed: report.passed,
    checks: report.checks.map((check) => ({
      id: check.id,
      status: check.status,
      detail: check.detail,
    })),
  };
}

export interface RecordStore {
  write(record: ReleaseRecord): Promise<string>;
  /** The newest record that is not a dry run. */
  latest(): Promise<ReleaseRecord | null>;
}

export function fileRecordStore(directory: string): RecordStore {
  return {
    async write(record) {
      await mkdir(directory, { recursive: true });
      const path = join(directory, `${record.releaseId}.json`);
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporary, path);
      return path;
    },
    async latest() {
      let names: string[];
      try {
        names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
      } catch {
        return null;
      }
      for (const name of names.reverse()) {
        try {
          const record = JSON.parse(await readFile(join(directory, name), 'utf8')) as ReleaseRecord;
          if (record.schemaVersion === RECORD_SCHEMA_VERSION && record.status !== 'dry-run')
            return record;
        } catch {
          // An unreadable file is not a record.
        }
      }
      return null;
    },
  };
}

export function memoryRecordStore(): RecordStore & { records: ReleaseRecord[] } {
  const records: ReleaseRecord[] = [];
  return {
    records,
    async write(record) {
      const copy = structuredClone(record);
      const index = records.findIndex((existing) => existing.releaseId === record.releaseId);
      if (index >= 0) records[index] = copy;
      else records.push(copy);
      return `memory:${record.releaseId}`;
    },
    async latest() {
      const real = records.filter((record) => record.status !== 'dry-run');
      return real.length ? structuredClone(real[real.length - 1]!) : null;
    },
  };
}
