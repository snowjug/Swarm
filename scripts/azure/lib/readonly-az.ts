import type { AzClient } from './az.js';
import { AzError } from './az.js';

/**
 * The pre-flight inspects an Azure subscription and must never change it. This wrapper is the control:
 * every `az` call goes through it, and it throws before the process is spawned unless the command is a
 * known read. It is an ALLOW-list (an unknown verb is refused, not tolerated), so a new `az` verb that
 * mutates stays refused until someone reads it and adds it here.
 */
export class MutationRefused extends Error {
  constructor(args: readonly string[]) {
    super(
      `Refused to run "az ${args.slice(0, 4).join(' ')}": the pre-flight is read-only and this is not a known read.`,
    );
    this.name = 'MutationRefused';
  }
}

/** The last word of a command that reads. Anything else (create, delete, set, add, update, start...) is refused. */
const READ_VERBS: ReadonlySet<string> = new Set([
  'show',
  'list',
  'list-skus',
  'list-usage',
  'list-usages',
  'list-locations',
  'list-definitions',
  'exists',
]);

/** `az rest` can do anything; only a GET to Azure Resource Manager or Microsoft Graph is a read. */
const REST_HOSTS: readonly string[] = [
  'https://management.azure.com/',
  'https://graph.microsoft.com/',
];

/** Options that carry a request body or change what a call does; none belongs in a read. `--debug` prints bearer tokens. */
const BODY_OPTIONS = new Set([
  '--body',
  '-b',
  '--headers',
  '--skip-authorization-header',
  '--debug',
]);

/**
 * Reads that would reveal a credential even though they only read. The inspection prints what it finds,
 * so a command whose answer holds a key, a secret or a token is refused whatever its verb.
 */
const SECRET_WORDS =
  /^(?:keys?|credentials?|secrets?|certificates?|sas|tokens?|connection-strings?|access-keys?|publishing-credentials|show-connection-string|get-access-token)$/u;
const SECRET_URL = /secret|keys|credential|token|connectionstring|listkeys|\bsas\b/iu;

function optionValue(args: readonly string[], names: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    for (const name of names) {
      if (arg === name) return args[index + 1];
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
    }
  }
  return undefined;
}

/** The command words before the first option: `group list --query x` is `group list`. */
function commandWords(args: readonly string[]): string[] {
  const words: string[] = [];
  for (const arg of args) {
    if (arg.startsWith('-')) break;
    words.push(arg);
  }
  return words;
}

export function isReadOnly(args: readonly string[]): boolean {
  if (args.length === 0) return false;
  if (args.some((arg) => BODY_OPTIONS.has(arg) || arg.startsWith('--body='))) return false;
  const words = commandWords(args);
  if (words.some((word) => SECRET_WORDS.test(word))) return false;
  if (words[0] === 'rest') {
    const method = (optionValue(args, ['--method', '-m']) ?? 'get').toLowerCase();
    const url = optionValue(args, ['--url', '--uri', '-u']) ?? '';
    return (
      method === 'get' &&
      REST_HOSTS.some((host) => url.startsWith(host)) &&
      !SECRET_URL.test(url.split('?')[0] ?? '')
    );
  }
  const verb = words[words.length - 1];
  return words.length >= 2 && verb !== undefined && READ_VERBS.has(verb);
}

export function assertReadOnly(args: readonly string[]): void {
  if (!isReadOnly(args)) throw new MutationRefused(args);
}

export interface ReadOnlyAz extends AzClient {
  /** Every command that was allowed through, in order, for the report. */
  readonly calls: readonly (readonly string[])[];
}

export function readOnlyAz(inner: AzClient): ReadOnlyAz {
  const calls: string[][] = [];
  return {
    calls,
    json: async <T>(args: readonly string[]) => {
      assertReadOnly(args);
      calls.push([...args]);
      return inner.json<T>(args);
    },
    text: async (args: readonly string[]) => {
      assertReadOnly(args);
      calls.push([...args]);
      return inner.text(args);
    },
  };
}

/** True for the failures that mean "there is no usable Azure session", which end the inspection politely. */
export function isNoSession(error: unknown): boolean {
  return (
    error instanceof AzError && (error.code === 'AZ_NOT_FOUND' || error.code === 'AZ_NOT_LOGGED_IN')
  );
}
