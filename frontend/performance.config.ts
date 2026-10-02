import { mergeConfig, defineConfig } from 'vite';
import config from './vite.config';

// Run from the measured revision's frontend directory, even when this harness
// is supplied from another checkout. Production aliases resolve in that root.
export default mergeConfig(config, defineConfig({
  root: process.cwd(),
  test: { include: [process.env.SHEETSPACE_PROBE ?? 'performance/*.probe.tsx'] },
}));
