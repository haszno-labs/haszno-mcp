import { defineConfig } from 'tsup'

export default defineConfig([
  // ── stdio binary (unchanged) ─────────────────────────────────────────────
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    // Inject shebang so `haszno-mcp` is directly executable after `npm install -g`.
    banner: { js: '#!/usr/bin/env node' },
  },
  // ── library entry (no shebang; external peer deps) ───────────────────────
  // The host application supplies @modelcontextprotocol/sdk and zod —
  // they must NOT be bundled into dist/lib.js.
  {
    entry: { lib: 'src/lib.ts' },
    format: ['esm'],
    dts: true,
    clean: false, // keep dist/index.js from the first entry
    sourcemap: true,
    external: [
      '@modelcontextprotocol/sdk',
      /^@modelcontextprotocol\/sdk\//,
      'zod',
    ],
  },
])
