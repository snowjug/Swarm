import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { MAX_PDF_BYTES } from '../../shared/guided.js';
import { makePdf } from './pdf-fixture.js';
import { testConfig } from './fixtures.js';
import { isAbsolute } from 'node:path';
import { pdfWorkerEnvironment } from '../src/ingest/pdf.js';

const applications: Awaited<ReturnType<typeof buildApp>>[] = [];
async function setup() {
  const instance = await buildApp({ config: testConfig() });
  applications.push(instance);
  return instance;
}
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

describe('isolated local PDF extraction', () => {
  it('provides absolute OS temp paths without inheriting provider or GitHub credentials', () => {
    const safe = pdfWorkerEnvironment({
      SystemRoot: 'C:\\Windows',
      OPENAI_API_KEY: 'test-provider-secret',
      AZURE_OPENAI_API_KEY: 'test-azure-secret',
      GH_TOKEN: 'test-github-secret',
    });
    expect(isAbsolute(safe.TEMP!)).toBe(true);
    expect(safe.TEMP).toBe(safe.TMP);
    expect(safe.TMPDIR).toBe(safe.TEMP);
    expect(Object.keys(safe).sort()).toEqual(
      ['NODE_ENV', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR'].sort(),
    );
    expect(JSON.stringify(safe)).not.toContain('secret');
  });

  it('extracts actual text from a real PDF without a model or native canvas dependency', async () => {
    const { app } = await setup();
    const text =
      'Fictional transit study: residents discuss accessible bus stops, funding, public evidence and a reversible pilot. No measured public opinion is provided.';
    const bytes = makePdf(text);
    const response = await app.inject({
      method: 'POST',
      url: '/api/documents/extract',
      payload: { name: 'source.pdf', data: bytes.toString('base64') },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      name: 'source.pdf',
      pageCount: 1,
      bytes: bytes.length,
    });
    expect(response.json<{ content: string }>().content).toContain('Fictional transit study');
    expect(response.json<{ content: string }>().content).toContain('accessible bus stops');
    expect(response.json<{ content: string }>().content.replace(/\s+/gu, ' ').trim()).toBe(text);
  });

  it('rejects excessive pages, scanned/no-text content, and wrong signatures explicitly', async () => {
    const { app } = await setup();
    for (const [bytes, code] of [
      [makePdf('This is a page.', 41), 'PDF_PAGE_LIMIT'],
      [
        makePdf('Transit evidence is fictional and must be checked. '.repeat(24), 40),
        'PDF_TEXT_LIMIT',
      ],
      [makePdf(''), 'PDF_NO_TEXT'],
      [Buffer.from('not a real PDF'), 'PDF_SIGNATURE'],
    ] as const) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/documents/extract',
        payload: { name: 'source.pdf', data: bytes.toString('base64') },
      });
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json()).toMatchObject({ error: { code } });
    }
  });

  it('validates filenames, base64 and the exact raw-byte boundary', async () => {
    const { app, pdf } = await setup();
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/documents/extract',
      payload: { name: '..\\secret.pdf', data: '!!!!' },
    });
    expect(invalid.statusCode).toBe(400);
    const tooLarge = Buffer.alloc(MAX_PDF_BYTES + 1, 32);
    tooLarge.write('%PDF-');
    await expect(pdf.extract('source.pdf', tooLarge.toString('base64'))).rejects.toMatchObject({
      code: 'PDF_BYTE_LIMIT',
    });
  });
});
