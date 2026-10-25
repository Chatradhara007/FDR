import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: path.resolve(here, '..'), // repo-root .env (VITE_API_URL)
  resolve: {
    alias: {
      '@': path.resolve(here, 'src'),
      '@fdr/shared': path.resolve(here, '../shared/src/index.ts'),
    },
  },
  server: { port: 5173, strictPort: true },
});
