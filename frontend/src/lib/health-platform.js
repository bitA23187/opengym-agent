import { MOBILE } from './mobile.js'

// Health Shortcuts are an iPhone browser action, shared by Home and health details.
export function canUseHealthShortcuts() {
  return !MOBILE && /iPhone/i.test(globalThis.navigator?.userAgent || '')
}
