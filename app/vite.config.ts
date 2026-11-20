import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

const base = process.env.VITE_BASE_PATH || '/';
if (!/^\/(?:[\w-]+\/)*$/.test(base)) {
  throw new Error('VITE_BASE_PATH must be / or a path such as /play/ with both slashes.');
}
const proxyPath = (path: string) => base.slice(0, -1) + path;
const stripBase = (path: string) => path.slice(base.length - 1);

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@tunes/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
            return 'vendor-react';
          }
          if (/node_modules\/(motion|framer-motion|motion-dom|motion-utils)\//.test(id)) {
            return 'vendor-motion';
          }
          if (/node_modules\/(socket\.io-client|socket\.io-parser|engine\.io-client|engine\.io-parser|@socket\.io)\//.test(id)) {
            return 'vendor-socketio';
          }
        },
      },
    },
  },
  server: {
    host: true,
    proxy: {
      [proxyPath('/licensed-audio')]: {
        target: 'http://localhost:3000',
        rewrite: stripBase,
      },
      [proxyPath('/socket.io')]: {
        target: 'http://localhost:3000',
        ws: true,
        rewrite: stripBase,
      },
    },
  },
});
