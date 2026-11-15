import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'path'

// Three products with web/native launch surfaces. Product entry modules live
// under src/products; shared API, auth, UI, and workflow modules stay in src.
const entry = (name) => resolve(__dirname, `${name}.html`)
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8001'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        operationsWeb: entry('index'),
        operationsApp: entry('operations-app'),
        darkStore: entry('darkstore'),
        consumerWeb: entry('shopper'),
        consumerApp: entry('consumer-app'),
        rider: entry('rider'),
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      // Product photos uploaded through the admin catalog live under Django's
      // MEDIA_ROOT. Without this the <img> tags 404 on the dev origin (:3000).
      '/media': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      '/ws': {
        target: apiProxyTarget.replace(/^http/, 'ws'),
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
