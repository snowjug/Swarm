import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * The only settings these scripts may write to `.env`. All are non-secret: identity-based access
 * means no key, token or connection string ever needs to reach a file.
 */
const RULES = {
  AI_PROVIDER: /^azure$/,
  AI_MODEL: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
  AZURE_OPENAI_ENDPOINT: /^https:\/\/[a-z0-9][a-z0-9-]{0,62}\.openai\.azure\.com\/?$/,
  AZURE_OPENAI_AUTH: /^entra$/,
  AZURE_CLIENT_ID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
} as const;

export type ManagedEnvKey = keyof typeof RULES;

export function isManagedKey(key: string): key is ManagedEnvKey {
  return Object.hasOwn(RULES, key);
}

export interface MergeResult {
  content: string;
  changed: ManagedEnvKey[];
}

export function mergeEnv(existing: string, updates: Readonly<Record<string, string>>): MergeResult {
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  const lines = existing === '' ? [] : existing.replace(/\r?\n$/, '').split(/\r?\n/);
  const changed: ManagedEnvKey[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (!isManagedKey(key))
      throw new Error(`Refusing to write ${key}: not an allowed non-secret setting.`);
    if (!RULES[key].test(value))
      throw new Error(`Refusing to write ${key}: the value has an unexpected format.`);
    const index = lines.findIndex((line) => new RegExp(`^\\s*${key}\\s*=`).test(line));
    if (index >= 0) lines[index] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
    changed.push(key);
  }
  return { content: `${lines.join(eol)}${eol}`, changed };
}

export async function updateEnvFile(
  path: string,
  updates: Readonly<Record<string, string>>,
): Promise<ManagedEnvKey[]> {
  let existing = '';
  try {
    existing = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const { content, changed } = mergeEnv(existing, updates);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
  return changed;
}
