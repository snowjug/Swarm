export interface DuplicateDeclaration {
  /** The template, and the chain of modules that holds it. */
  template: string;
  type: string;
  /** The name expression the declarations share. */
  name: string;
  /** Symbolic names (or positions) of the declarations that Azure sees as one resource. */
  declarations: string[];
}

/** Every set of declarations that Azure would see as one resource, in a compiled template and in the templates nested in it. */
export function findDuplicateDeclarations(
  template: unknown,
  where?: string,
): DuplicateDeclaration[];

export function describeDuplicates(duplicates: readonly DuplicateDeclaration[]): string;

/** Resources of a `bicep snapshot` that resolve to the same resource ID. */
export function findDuplicatePredictions(
  snapshot: { predictedResources?: readonly { id?: unknown }[] } | null,
): { id: string; count: number }[];
