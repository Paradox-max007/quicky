/**
 * Quicky — Android version bumper
 *
 * Increments versionCode (mandatory before every Play Store upload) and
 * optionally bumps versionName. Edits android/variables.gradle in place —
 * the single source of truth read by android/app/build.gradle.
 *
 * Usage (repo root):
 *   bun scripts/bump-android-version.ts                # versionCode +1
 *   bun scripts/bump-android-version.ts --patch        # 1.2.3 -> 1.2.4  + code
 *   bun scripts/bump-android-version.ts --minor        # 1.2.3 -> 1.3.0  + code
 *   bun scripts/bump-android-version.ts --major        # 1.2.3 -> 2.0.0  + code
 *   bun scripts/bump-android-version.ts --code 42      # set exact code 42
 *   bun scripts/bump-android-version.ts --name 2.1.0 --code 50
 */
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const GRADLE = resolve(import.meta.dir, '../android/variables.gradle')

function fail(msg: string): never {
  console.error(`error: ${msg}`)
  process.exit(1)
}

// ── Parse args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
let mode: 'patch' | 'minor' | 'major' | null = null
let name: string | null = null
let code: number | null = null

for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--patch' || a === '--minor' || a === '--major') mode = a.slice(2) as typeof mode
  else if (a === '--name') name = args[++i] ?? fail('--name requires a value like 2.1.0')
  else if (a === '--code') {
    const v = Number(args[++i])
    if (!Number.isInteger(v) || v < 1) fail('--code requires a positive integer')
    code = v
  } else fail(`unknown argument: ${a}`)
}

// ── Read current values ─────────────────────────────────────────────────────
let text = readFileSync(GRADLE, 'utf8')
const codeMatch = text.match(/^(\s*versionCode\s*=\s*)(\d+)\s*$/m)
const nameMatch = text.match(/^(\s*versionName\s*=\s*)"([^"]*)"\s*$/m)
if (!codeMatch || !nameMatch) fail('could not find versionCode/versionName in android/variables.gradle')

const curCode = Number(codeMatch[2])
const curName = nameMatch[2]

// ── Compute new version ─────────────────────────────────────────────────────
let newName = name
if (!newName && mode) {
  const parts = curName.split('.').map((p) => Number(p) || 0)
  while (parts.length < 3) parts.push(0)
  if (mode === 'patch') parts[2]++
  else if (mode === 'minor') { parts[1]++; parts[2] = 0 }
  else { parts[0]++; parts[1] = 0; parts[2] = 0 }
  newName = parts.join('.')
}
const newCode = code ?? curCode + 1
if (newCode <= curCode && code !== null) fail(`versionCode must increase: current ${curCode}, given ${newCode}`)
if (newName && !/^\d+(\.\d+){0,3}$/.test(newName)) fail(`invalid versionName: ${newName}`)

// ── Write back ──────────────────────────────────────────────────────────────
text = text.replace(codeMatch[0], `${codeMatch[1]}${newCode}`)
if (newName) text = text.replace(nameMatch[0], `${nameMatch[1]}"${newName}"`)
writeFileSync(GRADLE, text)

console.log(`versionCode: ${curCode} -> ${newCode}`)
if (newName) console.log(`versionName: ${curName} -> ${newName}`)
if (!newName) console.log(`versionName: unchanged (${curName}) — pass --patch/--minor/--major/--name to bump it`)
console.log('android/variables.gradle updated. Commit this before building the release bundle.')
