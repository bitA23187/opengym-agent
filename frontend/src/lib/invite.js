// Keep invitation codes in the router fragment, out of HTTP access logs/referrers.
// They only prefill registration; the API validates and consumes the code.
export function inviteCode(search) {
  const code = new URLSearchParams(search).get('invite')?.trim().toUpperCase() || ''
  return /^[A-F0-9]{16}$/.test(code) ? code : ''
}

export function inviteLink(base, code) {
  const normalized = inviteCode(new URLSearchParams({ invite: code }).toString())
  if (!normalized) throw Error('Invalid invitation code')
  const url = new URL(base)
  url.search = ''
  url.hash = '/?invite=' + normalized
  return url.href
}
