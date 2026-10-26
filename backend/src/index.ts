import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const { app } = await buildApp({ config });
let closing = false;

async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  try {
    await app.close();
  } catch {
    app.log.fatal('Backend shutdown failed. Check database availability and active work.');
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => {
  void shutdown();
});
process.once('SIGTERM', () => {
  void shutdown();
});
try {
  await app.listen({ host: config.host, port: config.port });
  if (config.host === '0.0.0.0' || config.host === '::') {
    app.log.warn(
      'This application has no user authentication. Use a loopback-only port mapping or an authenticated reverse proxy. Do not expose it directly to the internet.',
    );
  }
} catch (error) {
  const code = error instanceof Error && 'code' in error ? String(error.code) : 'STARTUP_ERROR';
  app.log.fatal({ code, host: config.host, port: config.port }, 'Cannot start the HTTP server.');
  await shutdown();
  process.exitCode = 1;
}
