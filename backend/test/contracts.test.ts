import { describe, expect, it } from 'vitest';
import {
  createProjectSchema,
  documentInputSchema,
  MAX_DOCUMENT_CHARS,
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
    const documents = [40_000, 40_000, 20_000].map((length, index) => ({
      name: `notes-${index}.txt`,
      content: 'x'.repeat(length),
    }));
    expect(documents.reduce((sum, document) => sum + document.content.length, 0)).toBe(
      MAX_TOTAL_CHARS,
    );
    expect(createProjectSchema.safeParse({ ...input, documents }).success).toBe(true);
    documents[2]!.content += 'x';
    expect(createProjectSchema.safeParse({ ...input, documents }).success).toBe(false);
  });

  it.each(['../../secret.md', '..\\secret.txt', 'program.exe', '.env', 'a\u0000.md', 'a\u007f.md'])(
    'rejects unsafe/unsupported document names: %s',
    (name) =>
      expect(documentInputSchema.safeParse({ name, content: sourceText }).success).toBe(false),
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
    expect(
      createProjectSchema.safeParse({ ...input, documents: Array(6).fill(input.documents[0]) })
        .success,
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
