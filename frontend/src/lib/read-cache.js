// Keep successful reads in memory for the current signed-in user and server.
let accounts = new WeakMap()

export function resetReadCache() { accounts = new WeakMap() }

export function cachedRead(user, path) {
  return accounts.get(user)?.get(path)?.value ?? null
}

export function invalidateRead(user, prefix) {
  const entries = accounts.get(user)
  for (const path of entries?.keys() || []) {
    if (path.startsWith(prefix)) entries.delete(path)
  }
}

export async function refreshRead(user, path, load, maxAge = 0) {
  let entries = accounts.get(user)
  if (!entries) accounts.set(user, entries = new Map())
  const previous = entries.get(path)
  if (previous?.pending) return previous.pending
  if (previous && Date.now() - previous.savedAt < maxAge) return previous.value
  const entry = { ...previous }
  entries.delete(path)
  entries.set(path, entry)
  if (entries.size > 32) entries.delete(entries.keys().next().value)
  entry.pending = Promise.resolve().then(load).then(value => {
    entry.value = value
    entry.savedAt = Date.now()
    return value
  }).finally(() => { delete entry.pending })
  return entry.pending
}
