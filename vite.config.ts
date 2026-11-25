import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => ({
  base: './',
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: mode === 'single'
    ? { outDir: 'dist-single', assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 5000 }
    : { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 1500 },
  publicDir: mode === 'single' ? false : 'public',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
}));
