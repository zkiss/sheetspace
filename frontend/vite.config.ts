import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfig from './tsconfig.json';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: Object.entries(tsconfig.compilerOptions.paths).map(([alias, [target]]) => ({
      find: new RegExp(`^${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\*', '(.*)')}$`),
      replacement: `/${tsconfig.compilerOptions.baseUrl}/${target.replace('*', '$1')}`,
    })),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    // Pure contracts do not need a browser or React Testing Library. Keep DOM
    // policy, hook, component and App tests in JSDOM, with isolated workers.
    environmentMatchGlobs: [
      ['architecture/**/*.test.ts', 'node'],
      ['src/{calculation,workbook,application/core,infrastructure/persistence}/**/*.test.ts', 'node'],
      ['src/grid/{cellInteraction,cellNavigation,clipboardPayload,gridAxisMetrics,gridAxisProjection,gridCellReveal,gridGeometry,gridRangeReveal,sheetGridModel}.test.ts', 'node'],
      ['src/workspace/{formattingActions,formattingShortcuts,NumberFormatControls,NumberFormatControls.colourState,NumberFormatControls.costEvidence,NumberFormatControls.projectionContract,sheetRenderingMode,workspaceFrameVirtualization}.test.ts', 'node'],
      ['src/reference-navigation/formulaInspection.test.ts', 'node'],
      ['src/app/gridFocusLease.test.ts', 'node'],
    ],
    setupFiles: './src/test-support/setup.ts',
    // The coverage suite shares one report directory and integration interactions are CPU-heavy.
    // A single worker makes the authoritative run deterministic in this shared checkout.
    minWorkers: 1,
    maxWorkers: 1,
    // App integration files exercise real keyboard and focus behavior. Under coverage,
    // parallel workers can make those interactions exceed Vitest's short default.
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      // Concurrent Vitest processes otherwise share coverage/.tmp and can remove
      // each other's intermediate V8 payloads before report generation.
      reportsDirectory: `coverage/${process.pid}`,
      reporter: ['text', 'html', 'json', 'lcov', 'cobertura'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/app/main.tsx',
        'src/test-support/**',
        'architecture/**',
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
    },
  },
});
