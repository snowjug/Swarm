import { describe, expect, it } from 'vitest';
import { loadConfig, publicConfig } from '../src/config.js';

describe('configuration of reading web pages', () => {
  it('is on by default, from ports 80 and 443, with a size, a time and no allow list', () => {
    const { urlIngestion } = loadConfig({});
    expect(urlIngestion).toEqual({
      enabled: true,
      allowedPorts: [80, 443],
      maxBytes: 1_500_000,
      timeoutMs: 12_000,
      allowedHosts: [],
    });
    expect(publicConfig(loadConfig({})).urlIngestion).toBe(true);
  });

  it.each([
    ['off', false],
    ['false', false],
    ['0', false],
    ['on', true],
    ['true', true],
    ['1', true],
  ])('reads URL_INGESTION=%s as %s, and says so in the public settings', (value, enabled) => {
    const config = loadConfig({ URL_INGESTION: value });
    expect(config.urlIngestion.enabled).toBe(enabled);
    expect(publicConfig(config).urlIngestion).toBe(enabled);
  });

  it.each(['', 'yes', 'ON', 'disabled', '2'])('refuses URL_INGESTION=%j, naming it', (value) => {
    expect(() => loadConfig({ URL_INGESTION: value })).toThrow('URL_INGESTION');
  });

  it('reads the ports, the size, the time and the allowed hosts', () => {
    const { urlIngestion } = loadConfig({
      URL_INGEST_ALLOWED_PORTS: '443, 8443,443',
      URL_INGEST_MAX_BYTES: '250000',
      URL_INGEST_TIMEOUT_MS: '5000',
      URL_INGEST_ALLOWED_HOSTS: 'Example.com, *.docs.example.org ,',
    });
    expect(urlIngestion).toEqual({
      enabled: true,
      allowedPorts: [443, 8443],
      maxBytes: 250_000,
      timeoutMs: 5_000,
      allowedHosts: ['example.com', '*.docs.example.org'],
    });
  });

  it.each([
    '',
    '0',
    '65536',
    '80;443',
    '80,abc',
    '-1',
    '1.5',
    '80,,443',
    '1,2,3,4,5,6,7,8,9,10,11',
  ])('refuses the ports %j', (ports) => {
    expect(() => loadConfig({ URL_INGEST_ALLOWED_PORTS: ports })).toThrow(
      'URL_INGEST_ALLOWED_PORTS',
    );
  });

  it.each(['9999', '5000001', 'big', '1.5'])('refuses a size of %j', (value) => {
    expect(() => loadConfig({ URL_INGEST_MAX_BYTES: value })).toThrow('URL_INGEST_MAX_BYTES');
  });

  it.each(['999', '25001', 'slow', '1.5'])('refuses a time of %j', (value) => {
    expect(() => loadConfig({ URL_INGEST_TIMEOUT_MS: value })).toThrow('URL_INGEST_TIMEOUT_MS');
  });

  it.each([
    'https://example.com',
    'example.com/path',
    'localhost',
    '*',
    '*.com',
    'a b.example.com',
    '127.0.0.1:80',
    'example.com:443',
    '.example.com',
    '*example.com',
    'exa_mple.com',
  ])('refuses the allowed host %j, which is not a host name', (host) => {
    expect(() => loadConfig({ URL_INGEST_ALLOWED_HOSTS: host })).toThrow(
      'URL_INGEST_ALLOWED_HOSTS',
    );
  });

  it('keeps the allowed hosts and the limits out of the public settings', () => {
    const config = loadConfig({
      URL_INGEST_ALLOWED_HOSTS: 'secret-host.example.com',
      URL_INGEST_ALLOWED_PORTS: '8443',
    });
    const text = JSON.stringify(publicConfig(config));
    expect(text).not.toContain('secret-host');
    expect(text).not.toContain('8443');
    expect(text).toContain('"urlIngestion":true');
  });

  it('lists CSV and JSON among the file types that can be added', () => {
    expect(publicConfig(loadConfig({})).capabilities.fileTypes).toEqual([
      'txt',
      'md',
      'markdown',
      'pdf',
      'csv',
      'json',
    ]);
  });

  it('has no setting that lets private addresses be read', () => {
    const config = loadConfig({
      URL_INGEST_ALLOW_PRIVATE: '1',
      URL_INGEST_ALLOW_LOOPBACK: 'true',
      ALLOW_PRIVATE_FOR_TESTS: '1',
    });
    expect(JSON.stringify(config.urlIngestion)).not.toMatch(/private|loopback|test/iu);
    expect(Object.keys(config.urlIngestion).sort()).toEqual([
      'allowedHosts',
      'allowedPorts',
      'enabled',
      'maxBytes',
      'timeoutMs',
    ]);
  });
});
