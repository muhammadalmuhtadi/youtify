import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: true,
    watch: {
      ignored: ['**/data/**', '**/*.db', '**/*.db-wal', '**/*.db-shm'],
    },
  },
});
