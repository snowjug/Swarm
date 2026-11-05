export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface Diagnostic {
  file: string;
  line: number;
  column: number;
  level: 'Error' | 'Warning' | 'Info';
  code: string;
  message: string;
}

export interface BicepCli {
  path: string;
  version: string | null;
  /** True when the version is the one in bicep.lock.json. */
  pinned: boolean;
}

export interface BicepAsset {
  file: string;
  bytes: number;
  sha256: string;
  verifiedByDownload: boolean;
}

export const REPO_ROOT: string;
export const LOCK: {
  version: string;
  source: string;
  assets: Record<string, BicepAsset>;
};
export const TEMPLATES: readonly string[];
export const PARAM_FILES: Readonly<Record<'pilot' | 'production-shaped', string>>;
export const PLACEHOLDER_SUBSCRIPTION: string;
export const PLACEHOLDER_TENANT: string;
export const PLACEHOLDER_ENV: Readonly<Record<string, string>>;

export function findBicep(env?: Record<string, string | undefined>): BicepCli | null;
export function runBicep(
  bicep: BicepCli,
  args: readonly string[],
  options?: { cwd?: string; env?: Record<string, string | undefined> },
): { status: number; stdout: string; stderr: string };
export function parseDiagnostics(text: string): Diagnostic[];
export function checkEnvironment(
  extra?: Record<string, string>,
  base?: Record<string, string | undefined>,
): Record<string, string>;
export function build(
  bicep: BicepCli,
  file: string,
): { status: number; json: Json | null; diagnostics: Diagnostic[] };
export function lint(bicep: BicepCli, file: string): { status: number; diagnostics: Diagnostic[] };
export function buildParams(
  bicep: BicepCli,
  file: string,
  extraEnv?: Record<string, string>,
): {
  status: number;
  parameters: Record<string, { value: Json }> | null;
  diagnostics: Diagnostic[];
};
export function buildParamsWithoutEnvironment(
  bicep: BicepCli,
  file: string,
  names?: readonly string[],
): { status: number; diagnostics: Diagnostic[] };
export function evaluate(
  bicep: BicepCli,
  paramFile: string,
  extraEnv?: Record<string, string>,
): { status: number; snapshot: Json | null; diagnostics: Diagnostic[] };
