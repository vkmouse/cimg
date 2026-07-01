import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

import { cloudflare } from "@cloudflare/vite-plugin"

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
	cloudflare()
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 11000,
    // Docker volume needs polling to detect file changes reliably.
    watch: {
      usePolling: true
    },
    // Support HMR from the host browser.
    hmr: {
      host: 'localhost',
      port: 11000,
      clientPort: 11000
    }
  }
})
