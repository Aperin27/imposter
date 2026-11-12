import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

export default defineConfig({
  plugins: [cloudflareTest({
    config: false,
    main: './worker/index.ts',
    miniflare: {
      compatibilityDate: '2026-11-12',
      durableObjects: { ROOMS: { className: 'Room', useSQLite: true } },
    },
  })],
  test: { include: ['tests/**/*.test.ts'], testTimeout: 15_000 },
});
