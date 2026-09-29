import { defineConfig } from 'tsup';

// Bundles workspace packages (@cpos/*) into the output; npm deps stay external.
export default defineConfig({
  entry: {
    server: 'server.ts',
    'worker/scheduled-reports': 'worker/scheduled-reports.ts',
    'scripts/set-webhook': 'scripts/set-webhook.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: true,
  noExternal: [/^@cpos\//],
});
