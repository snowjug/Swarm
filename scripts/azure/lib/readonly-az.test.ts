import { describe, expect, it, vi } from 'vitest';
import type { AzClient } from './az.js';
import {
  assertReadOnly,
  isNoSession,
  isReadOnly,
  MutationRefused,
  readOnlyAz,
} from './readonly-az.js';
import { AzError } from './az.js';

const split = (command: string): string[] => command.split(' ');

describe('what the pre-flight may run', () => {
  it.each([
    'account show',
    'account show --subscription 11111111-2222-3333-4444-555555555555',
    'account list-locations --query [].name',
    'group list --query [].name',
    'cognitiveservices account list',
    'cognitiveservices account deployment list --name a --resource-group g',
    'cognitiveservices usage list --location centralindia',
    'provider list --query [].namespace',
    'provider show --namespace Microsoft.App',
    'postgres flexible-server list-skus --location centralindia',
    'postgres flexible-server list',
    'acr list',
    'containerapp env list',
    'keyvault list',
    'monitor log-analytics workspace list',
    'resource list --resource-type Microsoft.Insights/components',
    'vm list --show-details',
    'policy assignment list',
    'consumption budget list',
    'ad signed-in-user show --query id',
    'role assignment list --assignee x --all',
    'rest --method get --url https://management.azure.com/subscriptions/x?api-version=2022-12-01',
    'rest --url https://graph.microsoft.com/v1.0/policies/authorizationPolicy',
  ])('allows %s', (command) => {
    expect(isReadOnly(split(command))).toBe(true);
  });

  it.each([
    'group create --name g --location centralindia',
    'group delete --name g --yes',
    'deployment group create --resource-group g --template-file t.bicep',
    'deployment group what-if --resource-group g',
    'role assignment create --assignee x --role Owner',
    'role assignment delete --ids x',
    'provider register --namespace Microsoft.App',
    'account set --subscription x',
    'login',
    'logout',
    'bicep install',
    'postgres flexible-server create --name s',
    'postgres flexible-server delete --name s --yes',
    'postgres flexible-server restore --name n --source-server s',
    'postgres flexible-server stop --name s',
    'postgres flexible-server firewall-rule create --name s',
    'containerapp update --name a --image i',
    'containerapp ingress traffic set --name a --revision-weight r=100',
    'containerapp revision deactivate --revision r',
    'acr build --registry r --image i .',
    'cognitiveservices account deployment create --name a',
    'ad app create --display-name x',
    'vm deallocate --name swarm-dev',
    'vm stop --name swarm-dev',
    'consumption budget create',
    'resource delete --ids x',
    'tag update --resource-id x',
  ])('refuses %s', (command) => {
    expect(isReadOnly(split(command))).toBe(false);
    expect(() => assertReadOnly(split(command))).toThrow(MutationRefused);
  });

  it('refuses what is not known to read: an allow-list, not a deny-list', () => {
    expect(isReadOnly(split('somenewservice frobnicate --name x'))).toBe(false);
    expect(isReadOnly(split('group'))).toBe(false);
    expect(isReadOnly([])).toBe(false);
  });

  it('refuses a REST call that is not a GET to Azure Resource Manager or Microsoft Graph', () => {
    for (const command of [
      'rest --method put --url https://management.azure.com/subscriptions/x/resourceGroups/g?api-version=1',
      'rest --method post --url https://management.azure.com/subscriptions/x/providers/Microsoft.App/register',
      'rest --method delete --url https://management.azure.com/subscriptions/x/resourceGroups/g',
      'rest --method patch --url https://management.azure.com/subscriptions/x',
      'rest --method get --url https://evil.example/steal',
      'rest --method get --url http://management.azure.com/subscriptions/x',
    ]) {
      expect(isReadOnly(split(command)), command).toBe(false);
    }
    expect(
      isReadOnly([
        'rest',
        '--method',
        'get',
        '--url',
        'https://management.azure.com/x',
        '--body',
        '{}',
      ]),
    ).toBe(false);
  });

  it('refuses reads that would put a credential on the screen, and the debug flag that prints tokens', () => {
    for (const command of [
      'keyvault secret show --vault-name v --name n',
      'keyvault secret list --vault-name v',
      'cognitiveservices account keys list --name a --resource-group g',
      'acr credential show --name r',
      'storage account keys list --account-name s',
      'account get-access-token',
      'postgres flexible-server show-connection-string --server-name s',
      'account show --debug',
      'rest --method get --url https://management.azure.com/subscriptions/x/providers/Microsoft.Storage/storageAccounts/s/listKeys',
    ]) {
      expect(isReadOnly(split(command)), command).toBe(false);
    }
  });
});

describe('readOnlyAz', () => {
  function inner() {
    const json = vi.fn(async () => ({ ok: true }));
    const text = vi.fn(async () => 'text');
    const az: AzClient = { json: json as unknown as AzClient['json'], text };
    return { az, json, text };
  }

  it('passes a read through and records it', async () => {
    const { az, json } = inner();
    const guarded = readOnlyAz(az);
    await expect(guarded.json(['group', 'list'])).resolves.toEqual({ ok: true });
    await expect(guarded.text(['account', 'show'])).resolves.toBe('text');
    expect(json).toHaveBeenCalledTimes(1);
    expect(guarded.calls).toEqual([
      ['group', 'list'],
      ['account', 'show'],
    ]);
  });

  it('stops a mutation before the wrapped client is ever called', async () => {
    const { az, json, text } = inner();
    const guarded = readOnlyAz(az);
    await expect(guarded.json(['group', 'delete', '--name', 'g'])).rejects.toBeInstanceOf(
      MutationRefused,
    );
    await expect(guarded.text(['deployment', 'group', 'create'])).rejects.toBeInstanceOf(
      MutationRefused,
    );
    expect(json).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    expect(guarded.calls).toEqual([]);
  });

  it('knows a missing or signed-out CLI from a failing command', () => {
    expect(isNoSession(new AzError('AZ_NOT_FOUND', 'x'))).toBe(true);
    expect(isNoSession(new AzError('AZ_NOT_LOGGED_IN', 'x'))).toBe(true);
    expect(isNoSession(new AzError('AZ_FAILED', 'x'))).toBe(false);
    expect(isNoSession(new Error('x'))).toBe(false);
  });
});
