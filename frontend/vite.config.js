import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const BACKEND_TARGET = 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/upload': BACKEND_TARGET,
      '/translate': BACKEND_TARGET,
      '/vocab': BACKEND_TARGET,
      '/health': BACKEND_TARGET
    }
  }
})