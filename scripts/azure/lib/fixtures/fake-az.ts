import { AzError, type AzClient } from '../az.js';

/** What a fake `az` answers: a value, an error to throw, or a function of the arguments. */
export type Reply = unknown | Error | ((args: readonly string[]) => unknown);

export interface Route {
  match: (args: readonly string[]) => boolean;
  reply: Reply;
}

/** True when every part appears in some argument: has('group', 'list') matches `az group list --query x`. */
export const has =
  (...parts: string[]) =>
  (args: readonly string[]) =>
    parts.every((part) => args.some((arg) => arg.includes(part)));

/** True when the first words are exactly these: words('group', 'list') matches `az group list ...` only. */
export const words =
  (...expected: string[]) =>
  (args: readonly string[]) =>
    expected.every((word, index) => args[index] === word);

/**
 * A scripted `az`. A call no route matches fails like a real failing call, so a test that forgot a route
 * fails loudly; every call is recorded in order for the test to inspect.
 */
export function fakeAz(routes: Route[]) {
  const calls: string[][] = [];
  const respond = async (args: readonly string[]): Promise<unknown> => {
    calls.push([...args]);
    const route = routes.find((candidate) => candidate.match(args));
    if (!route) throw new AzError('AZ_FAILED', `unexpected az call: ${args.slice(0, 4).join(' ')}`);
    if (route.reply instanceof Error) throw route.reply;
    return typeof route.reply === 'function' ? route.reply(args) : route.reply;
  };
  const az: AzClient = {
    json: async <T>(args: readonly string[]) => (await respond(args)) as T,
    text: async (args) => String(await respond(args)),
  };
  return { az, calls };
}
