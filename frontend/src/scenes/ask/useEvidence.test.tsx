// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../../../shared/types';
import '../../test/dom';
import type { DocumentInput } from './evidence';
import { useEvidence } from './useEvidence';

const net = vi.hoisted(() => ({ extractDataFile: vi.fn() }));
vi.mock('../../api/evidence', () => ({ evidenceApi: { extractDataFile: net.extractDataFile } }));

beforeEach(() => net.extractDataFile.mockReset());

const text = (opening: string): string =>
  `${opening} The harbour office sets the mooring fee for visiting boats each spring, once the council has agreed it.`;
const FIRST = text('First notes.');
const SECOND = text('Second notes.');
const THIRD = text('Third notes.');

/** The parts of the server's answer that these tests read. */
const configWith = (limits: Partial<AppConfig['limits']> = {}): AppConfig =>
  ({
    limits: {
      maxDocuments: 10,
      maxDocumentChars: 40_000,
      maxTotalChars: 200_000,
      maxPdfBytes: 2_000_000,
      maxPdfPages: 40,
      ...limits,
    },
    capabilities: { pdf: false },
  }) as unknown as AppConfig;

/** What the scene is to the hook: the list of sources it owns, and the way it is changed. */
const host = (config: AppConfig | null) =>
  renderHook(() => {
    const [documents, setDocuments] = useState<DocumentInput[]>([]);
    return useEvidence({ config, documents, onChange: setDocuments, disabled: false });
  });

const names = (documents: readonly DocumentInput[]) => documents.map((document) => document.name);

const aPage = (content: string): DocumentInput => ({
  name: 'harbour.example.org - Mooring fees.txt',
  content,
  provenance: {
    kind: 'url',
    url: 'https://harbour.example.org/fees',
    finalUrl: 'https://harbour.example.org/fees',
    retrievedAt: '2026-10-31T09:41:00.000Z',
    contentType: 'text/html',
    title: 'Mooring fees',
    fetchedByServer: true,
  },
});

/** A table that the server is still reading: the file is attached when `resolve` is called, and not before. */
function slowTable(name = 'table.csv') {
  let resolve!: (content: string) => void;
  net.extractDataFile.mockReturnValue(
    new Promise((done) => {
      resolve = (content) => done({ name, content });
    }),
  );
  return { file: new File(['a,b\n1,2'], name, { type: 'text/csv' }), resolve };
}

describe('sources attached at the same time', () => {
  it('keeps both of two sources attached in the same moment', () => {
    const { result } = host(null);
    act(() => {
      expect(result.current.addPaste('first.txt', FIRST)).toBe(true);
      expect(result.current.addPaste('second.txt', SECOND)).toBe(true);
    });
    expect(names(result.current.documents)).toEqual(['first.txt', 'second.txt']);
  });

  it('keeps a pasted source that was attached while a file was being read', async () => {
    const { result } = host(null);
    const table = slowTable();
    let reading!: Promise<void>;
    act(() => {
      reading = result.current.addFiles([table.file]);
    });
    expect(result.current.reading).toBe('table.csv');

    act(() => {
      result.current.addPaste('notes.txt', FIRST);
    });
    await act(async () => {
      table.resolve(SECOND);
      await reading;
    });

    expect(names(result.current.documents)).toEqual(['notes.txt', 'table.csv']);
    expect(result.current.error).toBeNull();
    expect(result.current.reading).toBeNull();
  });

  it('does not bring back a source that was taken away while a file was being read', async () => {
    const { result } = host(null);
    act(() => {
      result.current.addPaste('first.txt', FIRST);
    });
    act(() => {
      result.current.addPaste('second.txt', SECOND);
    });
    const table = slowTable();
    let reading!: Promise<void>;
    act(() => {
      reading = result.current.addFiles([table.file]);
    });

    act(() => result.current.remove(0));
    await act(async () => {
      table.resolve(THIRD);
      await reading;
    });

    expect(names(result.current.documents)).toEqual(['second.txt', 'table.csv']);
  });

  it('keeps the text of a source that was corrected while a file was being read', async () => {
    const { result } = host(null);
    act(() => {
      result.current.addPaste('first.txt', FIRST);
    });
    const table = slowTable();
    let reading!: Promise<void>;
    act(() => {
      reading = result.current.addFiles([table.file]);
    });

    act(() => result.current.update(0, `${FIRST} It is paid on arrival.`));
    await act(async () => {
      table.resolve(SECOND);
      await reading;
    });

    expect(result.current.documents[0]!.content).toBe(`${FIRST} It is paid on arrival.`);
    expect(names(result.current.documents)).toEqual(['first.txt', 'table.csv']);
  });

  it('refuses a file that no longer has room once it has been read, and keeps what filled the room', async () => {
    const { result } = host(configWith({ maxDocuments: 2 }));
    const table = slowTable();
    let reading!: Promise<void>;
    act(() => {
      reading = result.current.addFiles([table.file]);
    });
    act(() => {
      result.current.addPaste('first.txt', FIRST);
      result.current.addPaste('second.txt', SECOND);
    });

    await act(async () => {
      table.resolve(THIRD);
      await reading;
    });

    expect(names(result.current.documents)).toEqual(['first.txt', 'second.txt']);
    expect(result.current.error).toBe(
      'table.csv: Use at most 2 documents and 200,000 total characters.',
    );
    expect(result.current.reading).toBeNull();
  });

  it('counts what was attached meanwhile against the total, as the files are read', async () => {
    const { result } = host(configWith({ maxTotalChars: 300 }));
    const table = slowTable();
    let reading!: Promise<void>;
    act(() => {
      reading = result.current.addFiles([table.file]);
    });
    act(() => {
      result.current.addPaste('first.txt', FIRST);
    });

    // On its own the table fits, with the notes it does not.
    await act(async () => {
      table.resolve('x'.repeat(250));
      await reading;
    });

    expect(names(result.current.documents)).toEqual(['first.txt']);
    expect(result.current.error).toBe('table.csv: Combined source text exceeds 300 characters.');
  });
});

describe('a page the server fetched', () => {
  it('is attached, and the answer says so', () => {
    const { result } = host(null);
    let added = false;
    act(() => {
      added = result.current.addDocument(aPage(FIRST));
    });
    expect(added).toBe(true);
    expect(result.current.documents).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it('is not attached past the most that a project can hold, in the words of pasted text', () => {
    const { result } = host(configWith({ maxDocuments: 2 }));
    act(() => {
      result.current.addPaste('first.txt', FIRST);
      result.current.addPaste('second.txt', SECOND);
    });

    let added = true;
    act(() => {
      added = result.current.addDocument(aPage(THIRD));
    });
    expect(added).toBe(false);
    expect(names(result.current.documents)).toEqual(['first.txt', 'second.txt']);
    const words = 'Use at most 2 documents and 200,000 total characters.';
    expect(result.current.error).toBe(words);

    // Pasted text is refused in the very same words.
    act(() => {
      result.current.clearError();
    });
    let pasted = true;
    act(() => {
      pasted = result.current.addPaste('third.txt', THIRD);
    });
    expect(pasted).toBe(false);
    expect(result.current.error).toBe(words);
  });

  it('is not attached past the most that the sources may hold together', () => {
    const { result } = host(configWith({ maxTotalChars: FIRST.length + FIRST.length - 1 }));
    act(() => {
      result.current.addPaste('first.txt', FIRST);
    });

    let added = true;
    act(() => {
      added = result.current.addDocument(aPage(FIRST));
    });
    expect(added).toBe(false);
    expect(names(result.current.documents)).toEqual(['first.txt']);
    expect(result.current.error).toBe(
      `Use at most 10 documents and ${(FIRST.length * 2 - 1).toLocaleString('en-GB')} total characters.`,
    );
  });

  it('counts the pages and the pasted texts that were attached in the same moment', () => {
    const { result } = host(configWith({ maxDocuments: 2 }));
    const answers: boolean[] = [];
    act(() => {
      answers.push(result.current.addDocument(aPage(FIRST)));
      answers.push(result.current.addPaste('second.txt', SECOND));
      answers.push(result.current.addPaste('third.txt', THIRD));
    });
    expect(answers).toEqual([true, true, false]);
    expect(result.current.documents).toHaveLength(2);
  });
});
