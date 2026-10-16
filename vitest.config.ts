import { defineConfig } from 'vitest/config';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 全機規矩（Tim 2026-10-16）：測試 worker 預設 8、最多 8——這台 Mac 三個專案共用 18 核，
    // 預設值會依核心數開到 17 個。要更多只能 Tim 說；負載超過 100 時手動傳 --maxWorkers=4。
    maxWorkers: 8,
    minWorkers: 1,
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
    },
  },
});
