import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

const workers = {
  plugins: [cloudflareTest({
    config: false,
    main: './worker/index.ts',
    miniflare: {
      compatibilityDate: '2026-11-12',
      durableObjects: { ROOMS: { className: 'Room', useSQLite: true } },
      ratelimits: {
        CREATE_ROOM_LIMITER: { namespace_id: '41001', simple: { limit: 10, period: 60 } },
        JOIN_ROOM_LIMITER: { namespace_id: '41002', simple: { limit: 60, period: 60 } },
      },
    },
  })],
  test: { name: 'workers', include: ['tests/**/*.test.ts'], testTimeout: 15_000 },
};
export default defineConfig({
  test: { projects: [workers, {
    test: { name: 'ui', include: ['tests/**/*.test.tsx'], environment: 'jsdom',
      environmentOptions: { jsdom: { url: 'https://imposter.test/' } }, setupFiles: ['tests/ui.setup.tsx'] },
  }] },
});
