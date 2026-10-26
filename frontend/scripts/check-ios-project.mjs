#!/usr/bin/env node
// Validate app-local plugin wiring as well as source membership; parsing Swift alone misses both.
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../ios/App/', import.meta.url))
const read = relative => readFileSync(root + relative, 'utf8')
const converted = spawnSync('plutil', ['-convert', 'json', '-o', '-', root + 'App.xcodeproj/project.pbxproj'], { encoding: 'utf8' })
if (converted.status !== 0) throw new Error(converted.stderr || 'Cannot read Xcode project')
const { objects } = JSON.parse(converted.stdout)
const target = Object.values(objects).find(o => o.isa === 'PBXNativeTarget' && o.name === 'App')
const sources = target.buildPhases.map(id => objects[id]).find(o => o.isa === 'PBXSourcesBuildPhase')
const compiled = sources.files.map(id => objects[objects[id].fileRef].path)
for (const source of ['HealthKitPlugin.swift', 'HealthKitPlugin.m', 'HealthKitSync.swift', 'HealthSyncModels.swift', 'OpenGymBridgeViewController.swift']) {
  if (!compiled.includes(source)) throw new Error(`${source} is not compiled in the App target`)
  read('App/' + source)
}
const storyboard = read('App/Base.lproj/Main.storyboard')
if (!storyboard.includes('customClass="OpenGymBridgeViewController"')) throw new Error('Storyboard does not instantiate the local plugin bridge')
const bridge = read('App/OpenGymBridgeViewController.swift')
if (!bridge.includes('registerPluginInstance(HealthKitPlugin())')) throw new Error('Local HealthKit plugin is not explicitly registered')
const info = read('App/Info.plist'), entitlements = read('App/App.entitlements')
if (!info.includes('NSHealthShareUsageDescription') || !info.includes('ch.duartesantos.opengym.health-refresh') || !entitlements.includes('com.apple.developer.healthkit.background-delivery')) throw new Error('Health permissions/background configuration missing')
console.log('iOS project wiring OK: compiled sources, storyboard bridge, plugin registration and Health capabilities.')
