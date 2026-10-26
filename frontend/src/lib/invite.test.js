import { describe, it, expect } from 'vitest'
import { inviteCode, inviteLink } from './invite.js'

describe('registration invitations', () => {
  it('round trips a code in the hash without sending it in an HTTP query', () => {
    const link = new URL(inviteLink('https://gym.test/#/admin', '0123456789abcdef'))
    expect(link.search).toBe('')
    expect(link.hash).toBe('#/?invite=0123456789ABCDEF')
    expect(inviteCode(link.hash.split('?')[1])).toBe('0123456789ABCDEF')
    expect(inviteLink('https://gym.test/gym/#/admin', '0123456789ABCDEF')).toBe('https://gym.test/gym/#/?invite=0123456789ABCDEF')
  })
  it('does not accept device links, URLs, malformed or oversized codes', () => {
    for (const search of ['link=123456', 'invite=https://evil.test', 'invite=%3Cscript%3E', 'invite=' + 'A'.repeat(17), 'invite=']) {
      expect(inviteCode(search)).toBe('')
    }
    expect(() => inviteLink('https://gym.test', 'bad')).toThrow()
  })
})
