// Bump versi mobile di app/build.gradle.kts (versionCode naik + versionName).
//
// Usage (dari mana saja, path di-resolve dari lokasi file ini):
//   node mobile/scripts/bump.mjs 0.3.1           # versionName -> 0.3.1, versionCode +1
//   node mobile/scripts/bump.mjs                  # hanya patch: 0.1.0 -> 0.1.1, versionCode +1
//   node mobile/scripts/bump.mjs 0.3.1 --dry-run  # preview tanpa menulis
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const gradlePath = join(
  dirname(dirname(fileURLToPath(import.meta.url))), // mobile/
  'app',
  'build.gradle.kts',
)
const args = process.argv.slice(2)
const dry = args.includes('--dry-run')
const nextName = args.find((a) => /^\d+\.\d+\.\d+$/.test(a))

let s = await readFile(gradlePath, 'utf8')

const vcRe = /(versionCode\s*=\s*)(\d+)/
const vnRe = /(versionName\s*=\s*")([^"]+)(")/
const vcMatch = s.match(vcRe)
const vnMatch = s.match(vnRe)
if (!vcMatch || !vnMatch) {
  console.error('Tidak menemukan versionCode/versionName di build.gradle.kts')
  process.exit(1)
}
const oldCode = Number(vcMatch[2])
const oldName = vnMatch[2]
const newCode = oldCode + 1
const targetName = nextName ?? bumpPatch(oldName)

if (dry) {
  console.log(`[dry-run] versionCode ${oldCode} -> ${newCode}`)
  console.log(`[dry-run] versionName "${oldName}" -> "${targetName}"`)
  process.exit(0)
}

s = s.replace(vcRe, `$1${newCode}`)
s = s.replace(vnRe, `$1${targetName}$3`)
await writeFile(gradlePath, s)
console.log(`versionCode -> ${newCode}`)
console.log(`versionName -> "${targetName}"`)

function bumpPatch(v) {
  const [m, n, p] = v.split('.').map(Number)
  return `${m}.${n}.${p + 1}`
}
