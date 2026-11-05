import { describe, expect, it } from 'vitest';
import { build, findBicep, type BicepCli, type Json } from './bicep.mjs';
import {
  describeDuplicates,
  findDuplicateDeclarations,
  findDuplicatePredictions,
} from './duplicates.mjs';

/**
 * The offline check for the mistake that stopped the first deployment of the pilot: one template that
 * names the same resource twice ("The resource Microsoft.App/managedEnvironments/cae-swarm-pilot is
 * defined multiple times"). Bicep builds and lints such a template without a word; Azure refuses it.
 */

const environment = (extra: Record<string, unknown> = {}) => ({
  type: 'Microsoft.App/managedEnvironments',
  apiVersion: '2025-07-01',
  name: "[parameters('environmentResourceName')]",
  ...extra,
});

describe('findDuplicateDeclarations on a compiled template', () => {
  it('reports a created environment and a read of the same environment: the old container-app.bicep', () => {
    const template = {
      languageVersion: '2.0',
      resources: {
        workspace: {
          existing: true,
          type: 'Microsoft.OperationalInsights/workspaces',
          name: 'log',
        },
        createdEnvironment: environment({ condition: "[parameters('createEnvironment')]" }),
        environment: environment({ existing: true }),
        app: { type: 'Microsoft.App/containerApps', name: "[parameters('appName')]" },
      },
    };
    const found = findDuplicateDeclarations(template, 'container-app.bicep');
    expect(found).toEqual([
      {
        template: 'container-app.bicep',
        type: 'Microsoft.App/managedEnvironments',
        name: "parameters('environmentResourceName')",
        declarations: ['createdEnvironment', 'environment'],
      },
    ]);
    expect(describeDuplicates(found)).toContain('defined multiple times');
  });

  it('reports a pair whose conditions are opposite: Azure does not take the conditions into account', () => {
    const template = {
      resources: {
        created: environment({ condition: "[parameters('create')]" }),
        read: environment({ existing: true, condition: "[not(parameters('create'))]" }),
      },
    };
    expect(findDuplicateDeclarations(template)).toHaveLength(1);
  });

  it('compares the type without regard to case, and a name written with or without its brackets', () => {
    const template = {
      resources: [
        { type: 'Microsoft.App/managedEnvironments', name: "[parameters('n')]" },
        { type: 'microsoft.app/managedenvironments', name: "parameters('n')" },
      ],
    };
    expect(findDuplicateDeclarations(template)[0]?.declarations).toEqual([
      'resources[0]',
      'resources[1]',
    ]);
  });

  it('finds a duplicate inside a module, and names the module', () => {
    const template = {
      resources: [
        {
          type: 'Microsoft.Resources/deployments',
          name: 'app',
          properties: { template: { resources: [environment(), environment({ existing: true })] } },
        },
      ],
    };
    const [found] = findDuplicateDeclarations(template, 'main.bicep');
    expect(found?.template).toBe('main.bicep > resources[0] (app)');
  });

  it('does not report distinct names, distinct types, or two extension resources on different resources', () => {
    const roleOn = (scope: string) => ({
      type: 'Microsoft.Authorization/roleAssignments',
      name: "[guid(parameters('principal'))]",
      scope: `[resourceId('${scope}', parameters('name'))]`,
    });
    const template = {
      resources: [
        environment(),
        { ...environment(), name: "[parameters('other')]" },
        { type: 'Microsoft.App/containerApps', name: "[parameters('environmentResourceName')]" },
        roleOn('Microsoft.ContainerRegistry/registries'),
        roleOn('Microsoft.Insights/components'),
      ],
    };
    expect(findDuplicateDeclarations(template)).toEqual([]);
  });

  it('reports two extension resources on the same resource', () => {
    const roleOn = {
      type: 'Microsoft.Authorization/roleAssignments',
      name: "[guid(parameters('principal'))]",
      scope: "[resourceId('Microsoft.Insights/components', parameters('name'))]",
    };
    expect(findDuplicateDeclarations({ resources: [roleOn, { ...roleOn }] })).toHaveLength(1);
  });

  it('tolerates a template with no resources or something that is not a template', () => {
    expect(findDuplicateDeclarations({})).toEqual([]);
    expect(findDuplicateDeclarations(null)).toEqual([]);
    expect(findDuplicateDeclarations({ resources: [null, 3, { name: 'x' }] })).toEqual([]);
  });
});

describe('findDuplicatePredictions on the resources a snapshot predicts', () => {
  const id = (name: string) =>
    `/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.App/managedEnvironments/${name}`;

  it('reports one resource predicted twice, whatever the case of its name', () => {
    const found = findDuplicatePredictions({
      predictedResources: [{ id: id('cae-a') }, { id: id('cae-b') }, { id: id('CAE-A') }],
    });
    expect(found).toEqual([{ id: id('cae-a'), count: 2 }]);
  });

  it('leaves out an id that only Azure can resolve', () => {
    const expression = "[resourceId('x', reference('y').z)]";
    expect(
      findDuplicatePredictions({ predictedResources: [{ id: expression }, { id: expression }] }),
    ).toEqual([]);
  });
});

const bicep: BicepCli | null = findBicep();
// `npm run test:postgres` runs the whole suite against PostgreSQL; these tests touch no database.
const postgresRun = Boolean(process.env.SWARM_TEST_DATABASE);

describe.skipIf(!bicep || postgresRun)('the Bicep templates of the repository', () => {
  const compile = (file: string): Json => {
    const built = build(bicep as BicepCli, file);
    expect(built.diagnostics, file).toEqual([]);
    return built.json as Json;
  };

  it('the fixture of the old container-app.bicep is caught: the check is not vacuous', () => {
    const found = findDuplicateDeclarations(
      compile('scripts/iac/fixtures/duplicate-environment.bicep'),
      'duplicate-environment.bicep',
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      type: 'Microsoft.App/managedEnvironments',
      declarations: ['createdEnvironment', 'environment'],
    });
  }, 60_000);

  it('container-app.bicep declares no environment itself: it deploys the create module or the read module', () => {
    const template = compile('infra/pilot/modules/container-app.bicep') as {
      resources: Record<string, { type: string; name: string; condition?: string }>;
    };
    expect(findDuplicateDeclarations(template, 'container-app.bicep')).toEqual([]);
    const own = Object.values(template.resources);
    expect(own.map((resource) => resource.type)).not.toContain('Microsoft.App/managedEnvironments');
    // Exactly one of the two is deployed: their conditions are each other's opposite.
    const modules = Object.fromEntries(own.map((resource) => [resource.name, resource.condition]));
    expect(modules['environment-new']).toBe("[parameters('createEnvironment')]");
    expect(modules['environment-existing']).toBe("[not(parameters('createEnvironment'))]");
  }, 60_000);

  it('main.bicep and every module nested in it declare nothing twice', () => {
    expect(
      describeDuplicates(
        findDuplicateDeclarations(compile('infra/pilot/main.bicep'), 'main.bicep'),
      ),
    ).toBe('');
  }, 60_000);

  it('the create module declares the environment once, and the read module only reads it', () => {
    const created = compile('infra/pilot/modules/environment-new.bicep') as {
      resources: Record<string, { type: string; existing?: boolean }>;
    };
    expect(
      Object.values(created.resources)
        .filter((resource) => resource.type === 'Microsoft.App/managedEnvironments')
        .map((resource) => Boolean(resource.existing)),
    ).toEqual([false]);

    const read = compile('infra/pilot/modules/environment-existing.bicep') as {
      resources: unknown[];
      outputs: Record<string, { value: string }>;
    };
    expect(read.resources).toEqual([]);
    expect(read.outputs.defaultDomain?.value).toContain('reference(resourceId(');
  }, 60_000);
});
