import { describe, expect, it } from 'vitest';
import { detectSyncedFolder, loadConfig, publicConfig } from '../src/config.js';

describe('provider configuration and public boundaries', () => {
  it('defaults to local-only even when unrelated credentials exist', () => {
    const config = loadConfig({ OPENAI_API_KEY: 'not-a-real-key' });
    expect(config.provider.name).toBe('none');
    expect(config.provider.configured).toBe(false);
    expect(publicConfig(config).capabilities).toMatchObject({
      local: true,
      modelAssisted: false,
      pdf: true,
      guidedConsole: true,
      surveys: true,
      whatIf: true,
      webRetrieval: false,
      authentication: 'local-single-user',
    });
    expect(JSON.stringify(publicConfig(config))).not.toContain('not-a-real-key');
  });

  it('uses the Azure v1 endpoint and deployment name without exposing its key', () => {
    const config = loadConfig({
      AI_PROVIDER: 'azure',
      AI_MODEL: 'my-deployment',
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      AZURE_OPENAI_API_KEY: 'azure-test-placeholder',
    });
    expect(config.provider.baseUrl).toBe('https://example.openai.azure.com/openai/v1/');
    expect(config.provider.model).toBe('my-deployment');
    expect(config.provider.configured).toBe(true);
    const serialized = JSON.stringify(publicConfig(config));
    expect(serialized).not.toContain('azure-test-placeholder');
    expect(serialized).not.toContain('example.openai.azure.com');
    expect(publicConfig(config).provider.reason).toContain('not yet verified');
  });

  it.each([
    'http://untrusted.example/v1',
    'file:///etc/passwd',
    'https://user:password@example.com/v1',
    'https://example.com/v1?token=secret',
  ])('rejects unsafe administrator endpoint syntax explicitly: %s', (url) => {
    const config = loadConfig({
      AI_PROVIDER: 'openai',
      AI_MODEL: 'test',
      OPENAI_API_KEY: 'test-placeholder',
      OPENAI_BASE_URL: url,
    });
    expect(config.provider.configured).toBe(false);
    expect(config.provider.reason).toContain('Invalid provider endpoint');
    expect(config.provider.reason).not.toContain('password');
    expect(config.provider.reason).not.toContain('secret');
  });

  it('permits local Ollama without requiring a fake API key', () => {
    const config = loadConfig({ AI_PROVIDER: 'ollama', AI_MODEL: 'qwen3:8b' });
    expect(config.provider.configured).toBe(true);
    expect(config.provider.apiKey).toBeNull();
    expect(config.provider.baseUrl).toBe('http://127.0.0.1:11434/');
  });

  it('reports missing model credentials and rejects malformed server config', () => {
    expect(loadConfig({ AI_PROVIDER: 'azure', AI_MODEL: 'test' }).provider.reason).toContain(
      'AZURE_OPENAI_ENDPOINT',
    );
    expect(() => loadConfig({ PORT: 'invalid' })).toThrow('PORT');
    expect(() => loadConfig({ AI_PROVIDER: 'unsupported' })).toThrow('AI_PROVIDER');
    expect(() => loadConfig({ ALLOWED_ORIGINS: 'https://example.com/path' })).toThrow('exact HTTP');
    expect(() => loadConfig({ SOURCE_URL: 'javascript:alert(1)' })).toThrow('HTTPS');
  });

  it('keeps the production request limits unless a bounded integer scale is configured', () => {
    expect(loadConfig({}).rateLimitScale).toBe(1);
    expect(loadConfig({ RATE_LIMIT_SCALE: '50' }).rateLimitScale).toBe(50);
    for (const invalid of ['0', '-1', '1.5', '1001', 'many'])
      expect(() => loadConfig({ RATE_LIMIT_SCALE: invalid })).toThrow('RATE_LIMIT_SCALE');
  });

  it('derives loopback default origins from the API port without widening explicit allowlists', () => {
    expect(loadConfig({ PORT: '3002' }).allowedOrigins.has('http://127.0.0.1:3002')).toBe(true);
    expect(
      loadConfig({ PORT: '3002', ALLOWED_ORIGINS: 'https://example.com' }).allowedOrigins.has(
        'http://127.0.0.1:3002',
      ),
    ).toBe(false);
    expect(() => loadConfig({ ALLOWED_ORIGINS: '' })).toThrow('ALLOWED_ORIGINS');
  });

  it.each([
    ['C:\\Users\\a\\OneDrive\\Swarm\\data', 'OneDrive'],
    ['C:\\Users\\a\\OneDrive - Contoso\\Desktop\\Swarm\\data', 'OneDrive'],
    ['/home/a/Dropbox/swarm', 'Dropbox'],
    ['C:\\Users\\a\\Dropbox (Personal)\\swarm', 'Dropbox'],
    ['G:\\Google Drive\\swarm', 'Google Drive'],
    ['/Users/a/iCloud Drive/swarm', 'iCloud Drive'],
  ])('recognizes the cloud-synchronized folder in %s', (path, provider) => {
    expect(detectSyncedFolder(path)).toBe(provider);
  });

  it.each([
    'C:\\Users\\a\\AppData\\Local\\SwarmLab',
    '/var/lib/swarm-lab',
    '/app/data',
    'C:\\work\\onedrive-backup\\data',
    'C:\\work\\MyOneDriveNotes\\data',
  ])('does not flag ordinary local or look-alike directories: %s', (path) => {
    expect(detectSyncedFolder(path)).toBeNull();
  });

  it('warns about synchronized data directories without leaking the local path', () => {
    const synced = loadConfig({ DATA_DIR: 'C:\\Users\\jdoe\\OneDrive - Contoso\\Swarm\\data' });
    expect(synced.storageWarning).toContain('OneDrive synchronized folder');
    expect(synced.storageWarning).not.toContain('Contoso');
    expect(synced.storageWarning).not.toContain('jdoe');
    expect(publicConfig(synced).storage).toEqual({ warning: synced.storageWarning });
    const local = loadConfig({ DATA_DIR: 'C:\\Users\\jdoe\\AppData\\Local\\SwarmLab' });
    expect(local.storageWarning).toBeNull();
    expect(publicConfig(local).storage).toEqual({ warning: null });
  });
});
