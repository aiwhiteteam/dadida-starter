import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'index.ts',
    backfill: 'scripts/backfill.ts',
    'mem0-backfill': 'scripts/mem0-backfill.ts',
  },
  format: ['esm'],
  target: 'node20',
  external: ['better-sqlite3'],
  clean: true,
})
