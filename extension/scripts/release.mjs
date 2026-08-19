// Release helper for the extension.
//
// Usage (dari folder extension/):
//   node scripts/release.mjs patch        # 0.2.0 -> 0.2.1
//   node scripts/release.mjs minor        # 0.2.1 -> 0.3.0
//   node scripts/release.mjs major        # 0.2.1 -> 1.0.0
//   node scripts/release.mjs patch --dry-run   # preview tanpa menulis
//
// Alur: tes -> bump semver di manifest.json + package.json -> build ->
// zip (manifest.json + icon128.png + dist/) -> cetak sha256.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url))) // folder extension/
const args = process.argv.slice(2)
const level = args.find((a) => ['patch', 'minor', 'major'].includes(a)) ?? 'patch'
const dry = args.includes('--dry-run')

function bump(v, lvl) {
  const [m, n, p] = v.split('.').map(Number)
  if (lvl === 'major') return `${m + 1}.0.0`
  if (lvl === 'minor') return `${m}.${n + 1}.0`
  return `${m}.${n}.${p + 1}`
}
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'))

const manifestPath = join(root, 'manifest.json')
const pkgPath = join(root, 'package.json')
const manifest = await readJson(manifestPath)
const pkg = await readJson(pkgPath)
const next = bump(manifest.version, level)

if (dry) {
  console.log(`[dry-run] version ${manifest.version} -> ${next}`)
  console.log('[dry-run] manifest.json + package.json akan di-naikkan')
  console.log('[dry-run] build + zip dilewati (--dry-run)')
  process.exit(0)
}

manifest.version = next
pkg.version = next
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log(`bumped version -> ${next}`)

execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' })

execFileSync('npm', ['test'], { cwd: root, stdio: 'inherit' })

const outDir = join(root, 'build')
await mkdir(outDir, { recursive: true })
const zipName = `undip-sso-ext-v${next}.zip`
const zipPath = join(outDir, zipName)
try {
  execFileSync('zip', ['-r', '-9', zipPath, 'manifest.json', 'icon16.png', 'icon32.png', 'icon48.png', 'icon128.png', 'dist'], { cwd: root, stdio: 'inherit' })
} catch (e) {
  console.error('zip command gagal. Install `zip` (apt install zip) lalu ulangi.')
  process.exit(1)
}
const data = await readFile(zipPath)
const hash = createHash('sha256').update(data).digest('hex')
console.log(`created ${outDir}/${zipName}`)
console.log(`sha256  ${hash}`)
