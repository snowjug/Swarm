import { describe, expect, it } from 'vitest';
import {
  createProjectSchema,
  documentInputSchema,
  MAX_DOCUMENT_CHARS,
  MAX_DOCUMENTS,
  MAX_TOTAL_CHARS,
  settingsSchema,
} from '../../shared/types.js';
import { fixtureInput, sourceText } from './fixtures.js';

describe('input contracts', () => {
  it('accepts exact size limits and rejects one character above them', () => {
    expect(
      documentInputSchema.safeParse({ name: 'notes.md', content: 'x'.repeat(MAX_DOCUMENT_CHARS) })
        .success,
    ).toBe(true);
    expect(
      documentInputSchema.safeParse({
        name: 'notes.md',
        content: 'x'.repeat(MAX_DOCUMENT_CHARS + 1),
      }).success,
    ).toBe(false);
    const input = fixtureInput();
    // Ten documents at most, 200,000 characters in all, and 40,000 for any one of them.
    const documents = [40_000, 40_000, 40_000, 40_000, 40_000].map((length, index) => ({
      name: `notes-${index}.txt`,
      content: 'x'.repeat(length),
    }));
    expect(documents.reduce((sum, document) => sum + document.content.length, 0)).toBe(
      MAX_TOTAL_CHARS,
    );
    expect(createProjectSchema.safeParse({ ...input, documents }).success).toBe(true);
    documents[4]!.content += 'x';
    expect(createProjectSchema.safeParse({ ...input, documents }).success).toBe(false);
  });

  it('takes up to ten documents, and CSV and JSON files among them', () => {
    expect(MAX_DOCUMENTS).toBe(10);
    expect(MAX_TOTAL_CHARS).toBe(200_000);
    expect(MAX_DOCUMENT_CHARS).toBe(40_000);
    const input = fixtureInput();
    const ten = Array.from({ length: 10 }, (_, index) => ({
      name: `${['a', 'b'][index % 2]}-${index}.${['csv', 'json', 'txt', 'md', 'pdf'][index % 5]}`,
      content: sourceText,
    }));
    expect(createProjectSchema.safeParse({ ...input, documents: ten }).success).toBe(true);
    expect(createProjectSchema.safeParse({ ...input, documents: [...ten, ten[0]] }).success).toBe(
      false,
    );
  });

  it.each([
    '../../secret.md',
    '..\\secret.txt',
    'program.exe',
    '.env',
    'a\u0000.md',
    'a\u007f.md',
    'data.csv.exe',
    'data.json.',
    'data.xml',
    'dir/data.csv',
    'dir\\data.json',
  ])('rejects unsafe/unsupported document names: %s', (name) =>
    expect(documentInputSchema.safeParse({ name, content: sourceText }).success).toBe(false),
  );

  it.each(['prices.csv', 'PRICES.CSV', 'export.json', 'Data.Json', 'a b (1).csv'])(
    'accepts the data file name %s',
    (name) =>
      expect(documentInputSchema.safeParse({ name, content: sourceText }).success).toBe(true),
  );

  it('accepts locally extracted PDF text and bounded page metadata', () => {
    expect(
      documentInputSchema.safeParse({ name: 'scan.pdf', content: sourceText, pageCount: 1 })
        .success,
    ).toBe(true);
    expect(
      documentInputSchema.safeParse({ name: 'scan.pdf', content: sourceText, pageCount: 41 })
        .success,
    ).toBe(false);
  });

  it('rejects binary control characters without treating document text as executable HTML', () => {
    expect(
      documentInputSchema.safeParse({ name: 'a.txt', content: `${sourceText}\u0000` }).success,
    ).toBe(false);
    const input = documentInputSchema.parse({
      name: 'data.md',
      content: `${sourceText}\n<script>throw new Error('data only')</script>`,
    });
    expect(input.content).toContain('<script>');
  });

  it('validates document counts, minimum useful text, and defaults', () => {
    const input = fixtureInput();
    expect(createProjectSchema.safeParse({ ...input, documents: [] }).success).toBe(false);
    // Eleven is one more than a project may hold (it was six when the limit was five).
    expect(
      createProjectSchema.safeParse({
        ...input,
        documents: Array(MAX_DOCUMENTS + 1).fill(input.documents[0]),
      }).success,
    ).toBe(false);
    expect(documentInputSchema.safeParse({ name: 'a.md', content: 'a'.repeat(79) }).success).toBe(
      false,
    );
    expect(settingsSchema.parse({})).toMatchObject({
      mode: 'local',
      agentCount: 12,
      rounds: 8,
      seed: 42,
    });
  });

  it('enforces exact local/model limits and scheduled-event bounds', () => {
    expect(settingsSchema.safeParse({ agentCount: 24, rounds: 24 }).success).toBe(true);
    expect(settingsSchema.safeParse({ agentCount: 25 }).success).toBe(false);
    expect(settingsSchema.safeParse({ mode: 'llm', agentCount: 10, rounds: 10 }).success).toBe(
      true,
    );
    expect(settingsSchema.safeParse({ mode: 'llm', agentCount: 11, rounds: 10 }).success).toBe(
      false,
    );
    expect(
      settingsSchema.safeParse({
        rounds: 4,
        intervention: { round: 5, label: 'Extra funding', stance: 1, strength: 1 },
      }).success,
    ).toBe(false);
    expect(settingsSchema.safeParse({ seed: 0 }).success).toBe(false);
  });
});
