import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:8899',
      '/data': 'http://localhost:8899',
      '/compute': 'http://localhost:8899',
      '/action': 'http://localhost:8899',
      // Proxy only the JSON sub-paths of the share-link surface (issue #13);
      // the bare page /svar/:token must stay with Vite's SPA serving.
      '^/svar/[^/]+/(data|availability)$': 'http://localhost:8899',
      // The retired /link/:token still redirects (301 → /svar/:token).
      '^/link/[^/]+$': 'http://localhost:8899',
    },
  },
  build: {
    outDir: 'dist',
  },
})
