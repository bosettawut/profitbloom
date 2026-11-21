import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => {
  // local dev only: read API_PORT / WEB_PORT from .env when there is one (values already set on the command line win)
  if (command === 'serve') {
    try {
      process.loadEnvFile()
    } catch {
      // no .env file: the defaults below apply
    }
  }
  return config()
})

const config = () => ({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.WEB_PORT) || 5173,
    // the API's port; set API_PORT when 3001 is taken (server/index.js reads the same variable)
    proxy: { '/api': `http://localhost:${Number(process.env.API_PORT) || 3001}` },
  },
  resolve: {
    alias: [
      // Figma Make image imports (figma:asset/<hash>.png) → local files in src/assets
      { find: /^figma:asset\/(.*)$/, replacement: path.resolve(__dirname, './src/assets/$1') },
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
})
