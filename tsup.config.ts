import { defineConfig } from 'tsup';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  entry: ['src/cli/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  dts: true,
  sourcemap: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
});
