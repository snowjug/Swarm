import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const workspace = fileURLToPath(new URL('..', import.meta.url));
  const environment = loadEnv(mode, workspace, 'PORT');
  const apiPort = Number(process.env.PORT ?? environment.PORT ?? 3001);
  if (!Number.isInteger(apiPort) || apiPort < 1024 || apiPort > 65535) {
    throw new Error('PORT must be an integer between 1024 and 65535.');
  }
  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    envDir: workspace,
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': `http://127.0.0.1:${apiPort}`,
        '/auth': `http://127.0.0.1:${apiPort}`,
      },
    },
    // Libraries are chunks of their own, so that a release that changes only the application does not make a
    // browser fetch React again, and no single file is large. Scenes are chunks too (see app/scenes.ts): a
    // person who has opened the home screen has not fetched the stakeholder map or the report.
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      chunkSizeWarningLimit: 500,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (!id.includes('/node_modules/')) return undefined;
            if (/\/node_modules\/(?:react|react-dom|scheduler)\//u.test(id)) return 'react';
            if (/\/node_modules\/(?:motion|motion-dom|motion-utils|framer-motion)\//u.test(id))
              return 'motion';
            if (
              /\/node_modules\/(?:@radix-ui|@floating-ui|react-remove-scroll|react-remove-scroll-bar|react-style-singleton|use-callback-ref|use-sidecar|aria-hidden|get-nonce)\//u.test(
                id,
              )
            )
              return 'radix';
            if (/\/node_modules\/zod\//u.test(id)) return 'zod';
            return undefined;
          },
        },
      },
    },
  };
});
