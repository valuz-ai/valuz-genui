/**
 * Rewrite extensionless relative imports in an emitted dist tree to explicit
 * `.js` specifiers, so the published ESM resolves under plain Node (not only a
 * bundler). tsc with `moduleResolution: bundler` emits no extensions; this
 * adds them by checking the emitted filesystem (file → `.js`, directory →
 * `/index.js`). Runs over `.js` and `.d.ts` files.
 * Usage: node scripts/add-js-extensions.mjs <distDir>
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const distDir = resolve(process.argv[2] ?? 'dist')

/** All .js and .d.ts files under a directory. */
function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

/** Resolve a relative import to its concrete specifier, or null to leave it. */
function resolved(fromFile, spec) {
  if (spec.endsWith('.js') || spec.endsWith('.json') || spec.endsWith('.css')) return null
  const base = resolve(dirname(fromFile), spec)
  try {
    if (statSync(`${base}.js`).isFile()) return `${spec}.js`
  } catch {} // not a file with a .js sibling
  try {
    if (statSync(base).isDirectory() && statSync(join(base, 'index.js')).isFile()) return `${spec}/index.js`
  } catch {} // not a directory with an index
  return null
}

const IMPORT = /(\bfrom\s*|\bimport\s*\(\s*)(['"])(\.\.?\/[^'"]*)\2/g
let changed = 0
for (const file of walk(distDir)) {
  const src = readFileSync(file, 'utf8')
  const next = src.replace(IMPORT, (whole, kw, quote, spec) => {
    const fixed = resolved(file, spec)
    return fixed === null ? whole : `${kw}${quote}${fixed}${quote}`
  })
  if (next !== src) {
    writeFileSync(file, next)
    changed += 1
  }
}
console.log(`add-js-extensions: rewrote ${changed} file(s) under ${distDir}`)
