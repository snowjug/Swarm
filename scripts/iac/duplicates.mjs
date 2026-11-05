// A compiled template must not declare one resource twice. Azure Resource Manager refuses it while it
// validates the deployment ("The resource Microsoft.App/managedEnvironments/cae-swarm-pilot is defined
// multiple times"), even when one of the two declarations is only a read (`existing`) and even when a
// condition would switch one of them off. Bicep compiles such a template without a word, and so does
// `bicep lint`, so the mistake was found only by the first real deployment. This check finds it offline,
// on the compiled ARM template and on the resources `bicep snapshot` predicts. It never reaches Azure or
// the network.
//
// Two declarations of one template collide when they have the same type and the same name expression.
// The way out is a module that holds one of them (environment-new.bicep and environment-existing.bicep:
// create it, or else read it), because each module is a template of its own. Two extension resources
// (a role assignment, a diagnostic setting) that sit on different resources are different places and do
// not collide. The check is deliberately strict: a pair that conditions would keep apart is reported too,
// because that is cheaper to restructure than to find out about in a failed deployment.

/** The resources of a compiled template, with the key each is known by (a symbolic name or an index). */
function declarations(template) {
  const resources = template?.resources;
  if (Array.isArray(resources))
    return resources.map((resource, index) => [String(index), resource]);
  if (resources && typeof resources === 'object') return Object.entries(resources);
  return [];
}

/** `[expr]` and `expr` are the same expression. */
function normalise(expression) {
  if (typeof expression !== 'string') return expression === undefined ? '' : String(expression);
  const trimmed = expression.trim();
  return trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1).trim() : trimmed;
}

/** The resource an extension resource sits on, or '' for one that lives in a resource group. */
function scopeOf(resource) {
  const scope = typeof resource.scope === 'string' ? resource.scope.trim() : '';
  return /(?:^|[^.\w])(?:resourceId|extensionResourceId)\(/u.test(scope) ? normalise(scope) : '';
}

function label(key) {
  return /^\d+$/u.test(key) ? `resources[${key}]` : key;
}

/**
 * Every set of declarations in `template` that Azure would see as one resource, and the same for every
 * template nested in it (a module compiles to a nested deployment with its own template).
 *
 * @param {unknown} template A compiled ARM template.
 * @param {string} [where] A name for the template in messages, for example its file.
 * @returns {{ template: string, type: string, name: string, declarations: string[] }[]}
 */
export function findDuplicateDeclarations(template, where = 'template') {
  const found = [];
  const groups = new Map();
  for (const [key, resource] of declarations(template)) {
    if (!resource || typeof resource !== 'object' || typeof resource.type !== 'string') continue;
    const name = normalise(resource.name);
    const identity = [resource.type.toLowerCase(), name, scopeOf(resource)].join('|');
    const group = groups.get(identity) ?? { type: resource.type, name, keys: [] };
    group.keys.push(label(key));
    groups.set(identity, group);
  }
  for (const group of groups.values()) {
    if (group.keys.length > 1) {
      found.push({ template: where, type: group.type, name: group.name, declarations: group.keys });
    }
  }
  for (const [key, resource] of declarations(template)) {
    const nested = resource?.properties?.template;
    if (nested && typeof nested === 'object') {
      const name = typeof resource.name === 'string' ? resource.name : key;
      found.push(...findDuplicateDeclarations(nested, `${where} > ${label(key)} (${name})`));
    }
  }
  return found;
}

/** One line per duplicate, in the words of the error Azure would give. */
export function describeDuplicates(duplicates) {
  return duplicates
    .map(
      (one) =>
        `${one.template}: ${one.type} ${one.name} is declared ${one.declarations.length} times (${one.declarations.join(', ')}). Azure rejects this with "defined multiple times", whatever the conditions. Declare it once, or split the create and the read into two modules.`,
    )
    .join('\n');
}

/**
 * The same mistake, found by value: `bicep snapshot` resolves every name for a parameter file, so two
 * declarations whose name expressions differ but whose values are equal collide here.
 *
 * @param {{ predictedResources?: { id?: unknown }[] } | null} snapshot
 * @returns {{ id: string, count: number }[]}
 */
export function findDuplicatePredictions(snapshot) {
  const counts = new Map();
  for (const resource of snapshot?.predictedResources ?? []) {
    const id = typeof resource?.id === 'string' ? resource.id : '';
    // An id that only Azure can resolve is still an expression; it cannot be compared.
    if (!id || id.startsWith('[')) continue;
    const key = id.toLowerCase();
    const seen = counts.get(key);
    counts.set(key, { id: seen?.id ?? id, count: (seen?.count ?? 0) + 1 });
  }
  return [...counts.values()].filter((entry) => entry.count > 1);
}
