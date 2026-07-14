import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const serverRoot = resolve('src/server')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@server': serverRoot
      }
    },
    build: {
      outDir: resolve('out-server/main'),
      emptyOutDir: true,
      rollupOptions: {
        input: resolve('src/server/main/index.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@server': serverRoot
      }
    },
    build: {
      outDir: resolve('out-server/preload'),
      emptyOutDir: true,
      rollupOptions: {
        input: resolve('src/server/preload/index.ts')
      }
    }
  },
  renderer: {
    root: resolve('src/server/renderer'),
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@server': serverRoot
      }
    },
    plugins: [react()],
    build: {
      outDir: resolve('out-server/renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: resolve('src/server/renderer/index.html')
      }
    }
  }
})
