import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { MAX_PDF_BYTES, MAX_PDF_PAGES, type ExtractedPdf } from '../../../shared/guided.js';
import { documentInputSchema } from '../../../shared/types.js';
import { AppError, throwIfAborted } from '../errors.js';

export const pdfInputSchema = z.object({
  name: documentInputSchema.shape.name.refine(
    (name) => /\.pdf$/iu.test(name),
    'Select a PDF file.',
  ),
  data: z
    .string()
    .min(8)
    .max(Math.ceil(MAX_PDF_BYTES / 3) * 4)
    .regex(
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u,
      'Invalid base64 file data.',
    ),
});

const resultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), text: z.string(), pages: z.int().positive() }),
  z.object({
    ok: z.literal(false),
    code: z.enum(['PDF_PAGE_LIMIT', 'PDF_TEXT_LIMIT', 'PDF_NO_TEXT', 'PDF_PARSE_FAILED']),
  }),
]);
const publicErrors = {
  PDF_PAGE_LIMIT: `The PDF exceeds ${MAX_PDF_PAGES} pages.`,
  PDF_TEXT_LIMIT: 'The PDF exceeds 40,000 extracted characters. Use a smaller excerpt.',
  PDF_NO_TEXT:
    'The PDF has fewer than 80 extractable characters. Scanned PDFs need OCR, which is not implemented.',
  PDF_PARSE_FAILED:
    'The PDF is malformed, encrypted, or not supported. Export an unencrypted text PDF or upload TXT/Markdown.',
};

export function pdfWorkerEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const temporary = tmpdir();
  const systemRoot = environment.SystemRoot || environment.windir;
  return {
    NODE_ENV: 'production',
    TEMP: temporary,
    TMP: temporary,
    TMPDIR: temporary,
    ...(systemRoot ? { SystemRoot: systemRoot } : {}),
  };
}

export class PdfService {
  private readonly active = new Map<Worker, () => void>();
  private stopping = false;

  async extract(name: string, encoded: string, signal?: AbortSignal): Promise<ExtractedPdf> {
    if (this.stopping) throw new AppError(503, 'SERVER_STOPPING', 'The PDF service is stopping.');
    if (this.active.size)
      throw new AppError(
        429,
        'PDF_BUSY',
        'Another PDF is being processed. Try again after it finishes.',
      );
    if (signal) throwIfAborted(signal);
    const data = Buffer.from(encoded, 'base64');
    if (data.byteLength > MAX_PDF_BYTES)
      throw new AppError(
        413,
        'PDF_BYTE_LIMIT',
        `PDF files must not exceed ${MAX_PDF_BYTES.toLocaleString()} bytes.`,
      );
    if (data.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new AppError(422, 'PDF_SIGNATURE', 'The uploaded bytes do not have a PDF signature.');
    }
    const compiled = new URL('./pdf-worker.js', import.meta.url);
    const worker = new Worker(
      existsSync(compiled) ? compiled : new URL('./pdf-worker.ts', import.meta.url),
      {
        workerData: { data: new Uint8Array(data) },
        execArgv: existsSync(compiled) ? [] : ['--import', import.meta.resolve('tsx')],
        env: pdfWorkerEnvironment(),
        resourceLimits: {
          maxOldGenerationSizeMb: 192,
          maxYoungGenerationSizeMb: 32,
          stackSizeMb: 4,
        },
        stdout: true,
        stderr: true,
      },
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      const result = await new Promise<z.infer<typeof resultSchema>>((resolve, reject) => {
        let settled = false;
        const fail = (error: AppError): void => {
          if (settled) return;
          settled = true;
          reject(error);
        };
        this.active.set(worker, () =>
          fail(new AppError(503, 'SERVER_STOPPING', 'PDF extraction stopped with the backend.')),
        );
        onAbort = () => fail(new AppError(409, 'PDF_CANCELLED', 'PDF extraction was cancelled.'));
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
        timer = setTimeout(
          () =>
            fail(
              new AppError(
                422,
                'PDF_TIMEOUT',
                'PDF extraction exceeded its 10-second resource limit. Use a simpler file.',
              ),
            ),
          10_000,
        );
        worker.once('message', (message: unknown) => {
          if (settled) return;
          const parsed = resultSchema.safeParse(message);
          if (!parsed.success) {
            fail(
              new AppError(
                500,
                'PDF_WORKER_PROTOCOL',
                'The PDF worker returned an invalid response.',
              ),
            );
            return;
          }
          settled = true;
          resolve(parsed.data);
        });
        worker.once('error', (error) => {
          if ('code' in error && error.code === 'ERR_MODULE_NOT_FOUND') {
            fail(
              new AppError(
                500,
                'PDF_DEPENDENCY_MISSING',
                'The PDF service dependency is unavailable. Restore the declared dependencies.',
              ),
            );
          } else {
            fail(
              new AppError(
                422,
                'PDF_WORKER_FAILED',
                'The isolated PDF parser failed or exceeded its memory limit. Use a simpler file.',
              ),
            );
          }
        });
        worker.once('exit', () => {
          if (!settled)
            fail(
              new AppError(
                422,
                'PDF_WORKER_EXITED',
                'The PDF parser exited before producing text.',
              ),
            );
        });
        worker.stdout?.resume();
        worker.stderr?.resume();
      });
      if (!result.ok) throw new AppError(422, result.code, publicErrors[result.code]);
      const validated = documentInputSchema.parse({
        name,
        content: result.text,
        pageCount: result.pages,
      });
      return {
        name: validated.name,
        content: validated.content,
        pageCount: result.pages,
        bytes: data.byteLength,
      };
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      await worker.terminate();
      this.active.delete(worker);
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    for (const cancel of this.active.values()) cancel();
    await Promise.all([...this.active.keys()].map((worker) => worker.terminate()));
  }
}
