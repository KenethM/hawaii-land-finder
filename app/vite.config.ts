import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Data files are built by scripts/build_parcels.py into data/processed and served as static assets.
export default defineConfig({
  plugins: [react()],
  publicDir: '../data/processed',
  // Relative base so the built site works from any sub-path (e.g. GitHub Pages /repo-name/)
  base: './',
})
