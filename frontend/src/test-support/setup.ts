import { afterEach } from 'vitest';

// Node suites must not pay for DOM matchers, RTL or observer shims. Import RTL
// explicitly here: its automatic cleanup cannot register inside an async import.
if (typeof window !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
  const { cleanup } = await import('@testing-library/react/pure');
  await import('./domGeometry');
  afterEach(cleanup);
}
