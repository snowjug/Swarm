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
      proxy: { '/api': `http://127.0.0.1:${apiPort}` },
    },
    build: { outDir: 'dist', emptyOutDir: true },
  };
});
