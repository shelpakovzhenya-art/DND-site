import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: {
    entries: ['index.html'],
  },
  server: {
    watch: {
      ignored: [
        '**/.git/**',
        '**/dist/**',
        '**/Signal/**',
        '**/Signal-*/**',
        '**/signal_*/**',
        '**/outputs/**',
        '**/rendered_reports*/**',
        '**/tmp_*/**',
        '**/_prod_sync_*/**',
      ],
    },
  },
})
