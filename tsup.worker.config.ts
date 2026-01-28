import { defineConfig } from 'tsup';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  entry: ['src/worker/index.ts'],
  outDir: 'dist/worker',
  format: ['esm'],
  target: 'esnext', // Cloudflare Workers use V8 isolates
  platform: 'browser', // Workers are not Node.js
  clean: true,
  dts: false, // Not needed for Workers
  sourcemap: true,
  minify: true, // Reduce bundle size for Workers
  treeshake: true,
  // Bundle all dependencies EXCEPT Cloudflare Workers built-ins
  external: ['cloudflare:workers'],
  noExternal: [/^(?!cloudflare:).*/], // Bundle everything except cloudflare: imports
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
  esbuildOptions(options) {
    // Cloudflare Workers specific settings
    options.conditions = ['worker', 'browser'];
  },
});
