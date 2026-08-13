import { defineConfig } from 'vitest/config'

/** Testy jednostkowe nie potrzebuja pluginow Vite/Netlify - osobna konfiguracja. */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
