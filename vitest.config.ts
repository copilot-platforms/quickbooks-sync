import { defineConfig } from 'vitest/config'

// Note: `resolve.tsconfigPaths` is configured per-project below. When
// `projects` is defined, the root-level `resolve` block is ignored by Vitest,
// so duplicating it here would be dead config.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/db/migrations/**',
        'src/components/**',
      ],
    },
    projects: [
      {
        resolve: {
          tsconfigPaths: true,
        },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['test/unit/**/*.test.ts'],
          sequence: {
            // Run unit tests before integration tests when both projects run.
            groupOrder: 0,
          },
        },
      },
      {
        resolve: {
          tsconfigPaths: true,
        },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['test/integration/**/*.test.ts'],
          globalSetup: ['./test/integration/globalSetup.ts'],
          setupFiles: ['./test/integration/setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
          // One worker so the container URL set in globalSetup is inherited
          // and all integration tests share a single DB container.
          pool: 'forks',
          // Disable parallel execution so separate test files can't collide
          // on the shared test DB (e.g., concurrent inserts to qb_portal_connections).
          fileParallelism: false,
          isolate: false,
          sequence: {
            // Run integration tests after unit tests when both projects run.
            groupOrder: 1,
          },
        },
      },
    ],
  },
})
