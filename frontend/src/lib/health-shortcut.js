import { useStore } from '../store/useStore.js'
import { api, appBase } from './api.js'

// Keep the grant in this invocation only; never store it in the clipboard or local storage.
export async function launchHealthShortcut(name, parameters = {}) {
  const owner = useStore.getState().user?.id
  const server = new URL(appBase(), window.location.href).href.replace(/\/$/, '')
  const { token } = await api('/api/heart-rate/shortcut-session', { method: 'POST', body: '{}' })
  if (!/^ogs_[A-Za-z0-9_-]{43}$/.test(token || '')) throw new Error('无法启动同步，请重新登录后重试。')
  if (!owner || useStore.getState().user?.id !== owner) throw new Error('账户已切换，请重新点击同步。')
  const text = JSON.stringify({ ...parameters, server, authorization: 'Bearer ' + token })
  window.location.href = 'shortcuts://run-shortcut?name=' + encodeURIComponent(name) + '&input=text&text=' + encodeURIComponent(text)
}
