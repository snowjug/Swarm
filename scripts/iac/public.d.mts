import type { BicepCli, Diagnostic, Json } from './bicep.mjs';

export const PUBLIC_PARAM_FILE: string;
export const PUBLIC_PLACEHOLDER_ENV: Readonly<Record<string, string>>;
export const PUBLIC_FOUNDATION_ENV: Readonly<Record<string, string>>;
export const PUBLIC_GUEST_ENV: Readonly<Record<string, string>>;
export const PUBLIC_REQUIRED_VARIABLES: readonly string[];

export function buildPublicParams(
  bicep: BicepCli,
  env: Readonly<Record<string, string>>,
  without?: readonly string[],
): {
  status: number;
  parameters: Record<string, { value: Json }> | null;
  diagnostics: Diagnostic[];
};

export function evaluatePublic(
  bicep: BicepCli,
  env: Readonly<Record<string, string>>,
  without?: readonly string[],
): { status: number; snapshot: Json | null; diagnostics: Diagnostic[] };
