import { MOBILE } from './mobile.js'
// No plugin registration, credentials or Health access in browser/Android builds.
let pluginPromise
async function plugin() {
  if (!MOBILE) return null
  pluginPromise ||= import('@capacitor/core').then(({ Capacitor, registerPlugin }) => Capacitor.getPlatform() === 'ios' ? { native: registerPlugin('HealthKitSync') } : null)
  return pluginPromise
}
export async function isHealthKitClient() { return Boolean(await plugin()) }
// Native state changes replace periodic bridge calls. The returned cleanup also handles
// a component unmounting while Capacitor is still registering the listener.
export async function onHealthKitChange(callback) {
  const p = await plugin()
  if (!p) return () => {}
  const listener = await p.native.addListener('healthSyncChanged', callback)
  return () => listener.remove()
}
export async function healthKitStatus(owner) {
  const p = await plugin()
  if (!p) return { available: false, enabled: false }
  return p.native.status(await accountSession(owner))
}
async function accountSession(owner) {
  const { loadRemote } = await import('./remote.js')
  const remote = await loadRemote()
  let server
  try { server = new URL(remote?.base) } catch {}
  if (remote?.mode !== 'remote' || remote.user?.id !== owner || server?.protocol !== 'https:' || server.username || server.password || server.search || server.hash) throw new Error('Connect this account to your HTTPS server first.')
  if (typeof remote.token !== 'string' || !remote.token.trim()) throw new Error('Sign in to your server first.')
  return { server: remote.base, token: remote.token, owner }
}
export async function enableHealthKit(owner) {
  const p = await plugin()
  if (!p) throw new Error('HealthKit requires the OpenGym iPhone app.')
  return p.native.enable(await accountSession(owner))
}
export async function syncHealthKit(owner) {
  const p = await plugin()
  if (!p) return
  await healthKitStatus(owner) // Refresh a renewed account session before uploading.
  return p.native.sync({ owner })
}
export async function disableHealthKit() { return (await plugin())?.native.disable() }
