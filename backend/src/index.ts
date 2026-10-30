import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { startTelemetry } from './telemetry/azure-monitor.js';

const config = loadConfig();
// Before the application, so that nothing it does at start-up is missed. Off unless asked for.
const telemetry = await startTelemetry(process.env);
const { app } = await buildApp({ config });
if (telemetry.warning) app.log.warn(telemetry.warning);
let closing = false;

async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  try {
    await app.close();
    await telemetry.handle?.shutdown();
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
  if (config.storageWarning) app.log.warn(config.storageWarning);
  if (config.auth.mode === 'none' && (config.host === '0.0.0.0' || config.host === '::')) {
    app.log.warn(
      'AUTH_MODE is none: this application has no user authentication. Use a loopback-only port mapping or an authenticated reverse proxy, or set AUTH_MODE=entra. Do not expose it directly to the internet.',
    );
  }
} catch (error) {
  const code = error instanceof Error && 'code' in error ? String(error.code) : 'STARTUP_ERROR';
  app.log.fatal({ code, host: config.host, port: config.port }, 'Cannot start the HTTP server.');
  await shutdown();
  process.exitCode = 1;
}
