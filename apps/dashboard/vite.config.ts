import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = process.env.HOOKRELAY_API ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // The dashboard talks to the API through the dev server, so no CORS setup is needed.
    proxy: { '/api': api, '/in': api, '/health': api },
  },
});
