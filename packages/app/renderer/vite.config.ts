import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Standalone Vite config — chạy renderer trong browser preview mode
 * (không Electron). window.akabiz IPC sẽ tự dùng mockApi (xem src/mockApi.ts).
 *
 * Usage: npx vite -c packages/app/renderer/vite.config.ts
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    host: true,
    strictPort: false
  }
})
