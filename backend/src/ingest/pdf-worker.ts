import { parentPort, workerData } from 'node:worker_threads';
import { getDocumentProxy } from 'unpdf';
import { z } from 'zod';
import { MAX_PDF_PAGES } from '../../../shared/guided.js';
import { MAX_DOCUMENT_CHARS } from '../../../shared/types.js';

class PdfFailure extends Error {
  readonly code: 'PDF_PAGE_LIMIT' | 'PDF_TEXT_LIMIT' | 'PDF_NO_TEXT';
  constructor(code: PdfFailure['code']) {
    super(code);
    this.code = code;
  }
}

async function extract(): Promise<void> {
  const input = z.object({ data: z.instanceof(Uint8Array) }).parse(workerData);
  const pdf = await getDocumentProxy(input.data, {
    disableFontFace: true,
    enableXfa: false,
    stopAtErrors: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    isOffscreenCanvasSupported: false,
    disableAutoFetch: true,
    disableRange: true,
    disableStream: true,
    verbosity: 0,
  });
  try {
    if (pdf.numPages > MAX_PDF_PAGES) throw new PdfFailure('PDF_PAGE_LIMIT');
    const pages: string[] = [];
    let length = 0;
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const text = content.items
        .flatMap((item) => {
          if (!('str' in item) || typeof item.str !== 'string') return [];
          return [item.str, 'hasEOL' in item && item.hasEOL ? '\n' : ' '];
        })
        .join('')
        .trim();
      pages.push(text);
      length += text.length + 2;
      if (length > MAX_DOCUMENT_CHARS + 2) throw new PdfFailure('PDF_TEXT_LIMIT');
      page.cleanup();
    }
    const text = pages.join('\n\n').trim();
    if (text.length < 80) throw new PdfFailure('PDF_NO_TEXT');
    parentPort?.postMessage({ ok: true, text, pages: pdf.numPages });
  } finally {
    await pdf.loadingTask.destroy();
  }
}

try {
  await extract();
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    code: error instanceof PdfFailure ? error.code : 'PDF_PARSE_FAILED',
  });
} finally {
  parentPort?.close();
}
