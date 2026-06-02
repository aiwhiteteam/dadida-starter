import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'index.ts', backfill: 'scripts/backfill.ts' },
  format: ['esm'],
  target: 'node20',
  clean: true,
})
