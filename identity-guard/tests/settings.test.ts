import { test, expect } from 'claude-code/testing'
import { CLAUDE, HOME, PADDY, bash, commit, fakeGit, repoWith, toolBeneath } from './support'

const ALEX = { name: 'Alex Example', email: 'alex@example.com' }
const options = { allowList: ['Alex Example <alex@example.com>'] }

test('a custom allow-list is respected: the new name passes, the old ones are blocked', { options }, async ($, on) => {
  fakeGit(on, { global: CLAUDE, repos: { [HOME]: repoWith({ name: 'Alex Example', email: 'ALEX@example.com' }) } })
  const seen = toolBeneath(on)
  expect((await bash($, 'git commit -m x')).isError).toBeFalsy()
  expect(seen).toHaveLength(1)
})

test('with a custom list, Paddy is blocked and the message shows the custom list', { options }, async ($, on) => {
  fakeGit(on, { global: CLAUDE, repos: { [HOME]: repoWith(PADDY) } })
  const seen = toolBeneath(on)
  const result = await bash($, 'git commit -m x')
  expect(result.isError).toBe(true)
  expect(seen).toHaveLength(0)
  expect(result.text).toContain('Alex Example <alex@example.com>')
})

test('the name is compared exactly, the email in any case', async ($, on) => {
  fakeGit(on, { global: CLAUDE, repos: { [HOME]: repoWith({ name: 'paddy davies', email: 'paddy.davies@me.com' }) } })
  toolBeneath(on)
  expect((await bash($, 'git commit -m x')).isError).toBe(true)
})

test('a custom list also governs the push check', { options }, async ($, on) => {
  fakeGit(on, { global: CLAUDE, repos: { [HOME]: repoWith({}, [commit('1111111aaaaaaa', ALEX), commit('2222222aaaaaaa', PADDY)]) } })
  toolBeneath(on)
  const result = await bash($, 'git push')
  expect(result.isError).toBe(true)
  expect(result.text).toContain('2222222')
  expect(result.text).not.toContain('1111111')
})

test('an empty list falls back to the defaults rather than blocking everything', { options: { allowList: [] } }, async ($, on) => {
  fakeGit(on, { global: CLAUDE, repos: { [HOME]: repoWith({}) } })
  const seen = toolBeneath(on)
  expect((await bash($, 'git commit -m x')).isError).toBeFalsy()
  expect(seen).toHaveLength(1)
})
