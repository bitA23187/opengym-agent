#!/usr/bin/env node
// No signing identities, account credentials, or device required for --prepare.
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { checkCopy } from './check-mobile-bundle.mjs'
const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
if (args.some(a => !['--prepare', '--check', '--simulator', '--device'].includes(a))) throw new Error('Usage: npm run build:ios -- [--prepare | --check | --simulator | --device]')
function run(command, argv, options = {}) {
  const result = spawnSync(command, argv, { cwd: root, stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
const available = (command, argv) => spawnSync(command, argv, { cwd: root, stdio: 'ignore' }).status === 0
const xcode = available('xcrun', ['--sdk', 'iphoneos', '--show-sdk-path']) && available('xcodebuild', ['-version'])
const pods = available('pod', ['--version'])
if (args.includes('--check')) {
  console.log(`Full Xcode/iOS SDK: ${xcode ? 'available' : 'MISSING'}; CocoaPods: ${pods ? 'available' : 'MISSING'}`)
  process.exit(xcode && pods ? 0 : 2)
}
if (!args.includes('--prepare') && (!xcode || !pods)) {
  console.error('Full Xcode with iOS SDK and CocoaPods are required. Use --prepare to build and copy web assets only. No native binary has been built.')
  process.exit(2)
}
run(process.execPath, ['scripts/check-ios-project.mjs'])
run('npm', ['run', 'build'], { env: { ...process.env, VITE_MOBILE: '1' } })
run(process.execPath, ['../scripts/catalogue/stage-media.mjs', 'dist'])
run('npx', ['--no-install', 'cap', args.includes('--prepare') ? 'copy' : 'sync', 'ios'])
const problems = ['dist', 'ios/App/App/public'].flatMap(dir => checkCopy(resolve(root, dir)))
if (problems.length) throw new Error(problems.join('\n'))
if (args.includes('--prepare')) {
  console.log('iOS web assets prepared and checked. Native dependencies, compilation, signing and device verification are still pending.')
  process.exit(0)
}
const out = resolve(root, 'ios/App/output')
mkdirSync(out, { recursive: true })
// A generic destination compiles without a connected phone or downloaded simulator runtime.
const builds = args.includes('--simulator') ? ['simulator'] : args.includes('--device') ? ['device'] : ['simulator', 'device']
for (const build of builds) {
  run('xcodebuild', ['-workspace', 'ios/App/App.xcworkspace', '-scheme', 'App', '-configuration', 'Release',
    '-destination', build === 'simulator' ? 'generic/platform=iOS Simulator' : 'generic/platform=iOS',
    '-derivedDataPath', resolve(out, build), 'CODE_SIGNING_ALLOWED=NO', 'build'])
}
console.log('Unsigned native builds completed. These are compilation artifacts; a physical iPhone still requires development or distribution signing.')
