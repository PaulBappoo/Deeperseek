import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.NODE_ENV === 'production' 
          ? process.env.RENDER_EXTERNAL_URL || 'https://deeperseek.onrender.com'
          : 'http://localhost:10000',
        changeOrigin: true,
        secure: false
      }
    }
  },
  build: {
    outDir: '../public',
    emptyOutDir: true
  }
})