import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const main = read('infra/main.bicep');
const aiModule = read('infra/modules/ai-services.bicep');
const both = `${main}\n${aiModule}`;

// Static guard rails: they protect security-relevant properties of the templates without needing
// the Bicep CLI. The compiled templates are checked separately with `bicep build`.
describe('infrastructure templates', () => {
  it('disables local (key) authentication so only Entra ID can call the model', () => {
    expect(aiModule).toMatch(/disableLocalAuth:\s*true/);
    expect(aiModule).not.toMatch(/disableLocalAuth:\s*false/);
  });

  it('never creates, lists or outputs keys, secrets or connection strings', () => {
    expect(both).not.toMatch(/listKeys|primaryKey|secondaryKey|@secure|connectionString|apiKey/i);
    const outputs = both.split('\n').filter((line) => line.startsWith('output '));
    expect(outputs.length).toBeGreaterThan(0);
    outputs.forEach((line) => expect(line).not.toMatch(/key|secret|token|password/i));
  });

  it('allows pay-as-you-go SKUs only, with a capped capacity', () => {
    for (const source of [main, aiModule]) {
      expect(source).toContain("@allowed(['Standard', 'GlobalStandard', 'DataZoneStandard'])");
      expect(source).not.toMatch(/'Provisioned\w*'/);
      expect(source).toMatch(/@maxValue\(100\)/);
    }
  });

  it('grants only the inference role, not Contributor, Owner or a management role', () => {
    expect(aiModule).toContain('5e0bd9bd-7b93-4f28-af87-19fc36ad61bd');
    for (const roleId of [
      'b24988ac-6180-42a0-ab88-20f7382dd24c', // Contributor
      '8e3af657-a8ff-443c-a75c-2fe8c4bcb635', // Owner
      '18d7d88d-d35e-4fb5-a5c3-7773c20a72d9', // User Access Administrator
      'a97b65f3-24c7-4388-baec-2e87135dc908', // Cognitive Services User (broader)
    ]) {
      expect(both).not.toContain(roleId);
    }
  });

  it('keeps the default content filtering by not overriding the RAI policy', () => {
    expect(aiModule).not.toMatch(/raiPolicyName:/);
  });

  it('pins the model version so evaluations stay reproducible', () => {
    expect(aiModule).toMatch(/versionUpgradeOption:\s*'NoAutoUpgrade'/);
  });

  it('deploys the module into the group it creates', () => {
    expect(main).toMatch(/module ai 'modules\/ai-services\.bicep'/);
    expect(main).toMatch(/scope:\s*group/);
    expect(main).toMatch(/targetScope\s*=\s*'subscription'/);
    expect(aiModule).toMatch(/targetScope\s*=\s*'resourceGroup'/);
  });
});
