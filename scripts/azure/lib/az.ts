import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { win32 } from 'node:path';

export type AzErrorCode = 'AZ_NOT_FOUND' | 'AZ_NOT_LOGGED_IN' | 'AZ_FAILED' | 'AZ_BAD_JSON';

export class AzError extends Error {
  readonly code: AzErrorCode;

  constructor(code: AzErrorCode, message: string) {
    super(message);
    this.name = 'AzError';
    this.code = code;
  }
}

export interface AzLauncher {
  command: string;
  prefix: readonly string[];
}

/**
 * On Windows `az` is a batch file, which cannot be spawned without a shell (and a shell would
 * make argument handling injectable). The CLI ships its own python, so run that directly.
 */
export function resolveAzLauncher(
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
  exists: (path: string) => boolean = existsSync,
): AzLauncher {
  if (platform !== 'win32') return { command: 'az', prefix: [] };
  // Windows path rules apply whatever host runs this, so the lookup is the same everywhere.
  const searchPath = env.Path ?? env.PATH ?? '';
  for (const dir of searchPath.split(win32.delimiter)) {
    if (!dir || !exists(win32.join(dir, 'az.cmd'))) continue;
    const python = win32.join(win32.dirname(dir), 'python.exe');
    if (exists(python)) return { command: python, prefix: ['-IBm', 'azure.cli'] };
  }
  throw new AzError(
    'AZ_NOT_FOUND',
    'Azure CLI was not found on PATH. Install it from https://aka.ms/installazurecli, then run `az login`.',
  );
}

const JWT = /eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g;
const BEARER = /Bearer\s+[\w.~+/=-]{8,}/gi;
const SECRET_FIELD =
  /("?(?:access_?token|refresh_?token|client_?secret|password|primaryKey|secondaryKey|key1|key2)"?\s*[:=]\s*)"?[^"\s,}]+"?/gi;
const SAS_SIGNATURE = /([?&]sig=)[^&\s"]+/gi;

/** Azure CLI output is shown to humans and pasted into tickets: strip anything credential-shaped. */
export function sanitizeAzOutput(text: string, maxLength = 600): string {
  const cleaned = text
    .replace(JWT, '[redacted-token]')
    .replace(BEARER, 'Bearer [redacted]')
    .replace(SECRET_FIELD, '$1"[redacted]"')
    .replace(SAS_SIGNATURE, '$1[redacted]')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}…` : cleaned;
}

export function classifyAzFailure(stderr: string): AzErrorCode {
  return /az login|AADSTS|credentials have expired|no subscription found|not logged in/i.test(
    stderr,
  )
    ? 'AZ_NOT_LOGGED_IN'
    : 'AZ_FAILED';
}

export interface RunAzOptions {
  timeoutMs?: number;
}

export function runAz(args: readonly string[], options: RunAzOptions = {}): Promise<string> {
  const launcher = resolveAzLauncher();
  return new Promise((resolve, reject) => {
    execFile(
      launcher.command,
      [...launcher.prefix, ...args],
      {
        maxBuffer: 64 * 1024 * 1024,
        timeout: options.timeoutMs ?? 15 * 60_000,
        windowsHide: true,
        env: {
          ...process.env,
          AZURE_CORE_COLLECT_TELEMETRY: 'false',
          AZURE_CORE_NO_COLOR: 'true',
          AZURE_CORE_ONLY_SHOW_ERRORS: 'true',
          PYTHONIOENCODING: 'utf-8',
        },
      },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        const detail = sanitizeAzOutput(stderr || error.message);
        reject(new AzError(classifyAzFailure(stderr), detail || 'The Azure CLI command failed.'));
      },
    );
  });
}

export async function runAzJson<T>(
  args: readonly string[],
  options: RunAzOptions = {},
): Promise<T> {
  const raw = await runAz([...args, '-o', 'json'], options);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new AzError('AZ_BAD_JSON', 'The Azure CLI returned output that is not valid JSON.');
  }
}

/** Seam for tests: orchestration depends on this, never on a spawned process. */
export interface AzClient {
  json<T>(args: readonly string[]): Promise<T>;
  text(args: readonly string[]): Promise<string>;
}

export const realAz: AzClient = {
  json: (args) => runAzJson(args),
  text: (args) => runAz(args),
};
