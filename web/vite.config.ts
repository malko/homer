import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@assets': path.resolve(__dirname, './assets'),
    },
  },
  server: {
    port: 5174,
    allowedHosts: ['localhost', 'desk.home'],
    host:"0.0.0.0",
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        ws: true,
        configure: (proxy) => {
          proxy.on('error', () => {}); // silence ECONNRESET on WS close
        },
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
