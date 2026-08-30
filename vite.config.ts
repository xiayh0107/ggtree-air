import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: path.resolve(root, 'frontend'),
  plugins: [react()],
  build: {
    outDir: path.resolve(root, 'frontend/dist'),
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: 'app.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (assetInfo) => assetInfo.name?.endsWith('.css') ? 'styles.css' : 'assets/[name]-[hash][extname]',
        inlineDynamicImports: true,
      },
    },
  },
})
