import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'path'

// Three applications, one source tree. Each HTML file boots its own React
// root and sets `data-app` on <html>, which src/apps/registry.js reads to
// decide which console this bundle is. They are separate installs in the same
// way the big quick-commerce players ship a customer app, a store-partner app
// and a delivery-partner app.
const entry = (name) => resolve(__dirname, `${name}.html`)

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        store: entry('index'),
        shopper: entry('shopper'),
        rider: entry('rider'),
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      // Product photos uploaded through the admin catalog live under Django's
      // MEDIA_ROOT. Without this the <img> tags 404 on the dev origin (:3000).
      '/media': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
