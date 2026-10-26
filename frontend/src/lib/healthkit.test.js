import { it, expect, vi, beforeEach } from 'vitest'
vi.mock('./mobile.js', () => ({ MOBILE: true }))
vi.mock('@capacitor/core', () => ({ Capacitor: {getPlatform: () => 'ios'}, registerPlugin: () => native }))
vi.mock('./remote.js', () => ({loadRemote: vi.fn()}))
const native = {enable:vi.fn(), status:vi.fn(), sync:vi.fn(), disable:vi.fn(), addListener:vi.fn()}
import { loadRemote } from './remote.js'
import { enableHealthKit, disableHealthKit, healthKitStatus, onHealthKitChange } from './healthkit.js'
beforeEach(() => { vi.clearAllMocks();loadRemote.mockResolvedValue({mode:'remote',base:'https://gym.example',token:'signed-in-session',user:{id:'alice'}}) })
it('subscribes to native status events and removes only its listener', async () => {
 const remove = vi.fn(), callback = vi.fn()
 native.addListener.mockResolvedValue({remove})
 const unsubscribe = await onHealthKitChange(callback)
 expect(native.addListener).toHaveBeenCalledWith('healthSyncChanged', callback)
 await unsubscribe()
 expect(remove).toHaveBeenCalledOnce()
 expect(loadRemote).not.toHaveBeenCalled()
})
it('enables with the current login session without a second credential', async () => {
 native.enable.mockResolvedValue({enabled:true})
 await enableHealthKit('alice')
 expect(native.enable).toHaveBeenCalledWith({server:'https://gym.example',token:'signed-in-session',owner:'alice'})
})
it('rejects another account or unencrypted server before native access', async () => {
 await expect(enableHealthKit('bob','token')).rejects.toThrow('Connect this account')
 loadRemote.mockResolvedValue({mode:'remote',base:'http://gym.example',user:{id:'alice'}})
 await expect(enableHealthKit('alice','token')).rejects.toThrow('HTTPS')
 expect(native.enable).not.toHaveBeenCalled()
})
it('passes ownership on status and clears native configuration on disable', async () => {
 await healthKitStatus('alice'); expect(native.status).toHaveBeenCalledWith({server:'https://gym.example',token:'signed-in-session',owner:'alice'})
 await disableHealthKit();expect(native.disable).toHaveBeenCalledOnce()
})
it('refreshes the native session when the app login is renewed', async () => {
 await healthKitStatus('alice')
 loadRemote.mockResolvedValue({mode:'remote',base:'https://gym.example',token:'renewed-session',user:{id:'alice'}})
 await healthKitStatus('alice')
 expect(native.status).toHaveBeenLastCalledWith({server:'https://gym.example',token:'renewed-session',owner:'alice'})
})

it('rejects invalid server URLs and embedded credentials before exposing the upload key', async () => {
 for (const base of ['https://name:password@gym.example', 'https://gym.example?token=x', 'https://gym.example#x', 'https://']) {
  loadRemote.mockResolvedValue({mode:'remote',base,user:{id:'alice'}})
  await expect(enableHealthKit('alice','token')).rejects.toThrow('HTTPS')
 }
 expect(native.enable).not.toHaveBeenCalled()
})
