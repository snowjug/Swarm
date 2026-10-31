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
    // The entry chunk (React, the schemas and the entry console) is kept under this size. The project
    // console is a chunk of its own, fetched when a project opens (see App.tsx), and is under it too.
    build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 500 },
  };
});
