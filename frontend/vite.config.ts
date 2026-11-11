import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In production the Static Web App proxies /api to the Container App (linked backend), so the app is same-origin.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8080' } },
});
