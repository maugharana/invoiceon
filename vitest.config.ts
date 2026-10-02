import { defineConfig } from 'vitest/config';

// The data-layer tests are quick, but a few do real file work or hash PINs, which can take a while on a busy computer.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 30_000 } });
