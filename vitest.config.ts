import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/__test__/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/**/*.d.ts',
        '**/node_modules/**',
      ],
    },
  },
})
