import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@workbook': '/src/workbook',
      '@calculation': '/src/calculation',
      '@application': '/src/application',
      '@infrastructure': '/src/infrastructure',
      '@app': '/src/app',
      '@grid': '/src/grid',
      '@workspace': '/src/workspace',
      '@reference-navigation': '/src/reference-navigation',
      '@shared': '/src/shared',
      '@test-support': '/src/test-support',
    },
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
    setupFiles: './src/test-support/setup.ts',
    // App integration files exercise real keyboard and focus behavior. Under coverage,
    // parallel workers can make those interactions exceed Vitest's short default.
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/app/main.tsx',
        'src/test-support/**',
        'src/architecture/**',
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
