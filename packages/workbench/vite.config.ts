import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import VueDevTools from 'vite-plugin-vue-devtools'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    VueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@piddie': fileURLToPath(new URL('../', import.meta.url))
    }
  },
  optimizeDeps: {
    exclude: ['@piddie/project-management', '@piddie/chat-context', '@piddie/files-management']
  }
})
