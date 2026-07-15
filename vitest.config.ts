import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/__test__/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/**/*.d.ts'],
    },
  },
})
