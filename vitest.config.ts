import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/__test__/**/*.spec.ts'],
    // Importing the full `typescript` module in specs can take >10s on cold
    // starts / slow disks; the 5s default made those tests flake.
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/**/*.d.ts'],
    },
  },
})
