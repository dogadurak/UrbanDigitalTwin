import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // The default `forks` pool does not come up on Windows here: the worker
    // never answers and the run dies after sixty seconds having executed
    // nothing. Threads start immediately and these tests share no state.
    pool: 'threads',
  }
})
