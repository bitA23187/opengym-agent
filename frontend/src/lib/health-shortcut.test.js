// @vitest-environment happy-dom
import { it, expect, vi, beforeEach } from 'vitest'
import { launchHealthShortcut } from './health-shortcut.js'
import { api } from './api.js'
import { useStore } from '../store/useStore.js'
vi.mock('./api.js', () => ({ api: vi.fn(), appBase: () => '/gym/' }))
beforeEach(() => { useStore.setState({ user: { id: 'alice' } }); api.mockReset(); window.location.href = 'https://gym.example/gym/#/home' })
it('passes an ephemeral grant and current server to Shortcuts without manual configuration', async () => {
  api.mockResolvedValue({ token: 'ogs_' + 'a'.repeat(43) })
  await launchHealthShortcut('OpenGym 日常健康同步')
  expect(api).toHaveBeenCalledWith('/api/heart-rate/shortcut-session', { method: 'POST', body: '{}' })
  const url = new URL(window.location.href)
  expect(url.protocol).toBe('shortcuts:')
  expect(url.searchParams.get('name')).toBe('OpenGym 日常健康同步')
  expect(JSON.parse(url.searchParams.get('text'))).toEqual({ server: 'https://gym.example/gym', authorization: 'Bearer ogs_' + 'a'.repeat(43) })
})
it('does not launch after an account switch or an invalid grant response', async () => {
  api.mockImplementation(async () => { useStore.setState({user:{id:'bob'}}); return {token:'ogs_'+'a'.repeat(43)} })
  await expect(launchHealthShortcut('sync')).rejects.toThrow('账户已切换')
  expect(window.location.protocol).toBe('https:')
  api.mockResolvedValue({token:'account-session'})
  await expect(launchHealthShortcut('sync')).rejects.toThrow('无法启动同步')
})
