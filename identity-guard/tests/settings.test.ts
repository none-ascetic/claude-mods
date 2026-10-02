import { test, expect } from 'claude-code/testing'
import { CLAUDE, HOME, PADDY, bash, commit, repoWith, setup } from './support'

const ALEX = { name: 'Alex Example', email: 'alex@example.com' }
const options = { allowList: ['Alex Example <alex@example.com>'] }

test('a custom allow-list is respected: the new name passes, the old ones are blocked', { options }, async ($, on) => {
  const { seen } = setup(on, { global: CLAUDE, repos: { [HOME]: repoWith({ name: 'Alex Example', email: 'ALEX@example.com' }) } })
  expect((await bash($, 'git commit -m x')).deny).toBeUndefined()
  expect(seen).toHaveLength(1)
})

test('with a custom list, Paddy is blocked and the message shows the custom list', { options }, async ($, on) => {
  const { seen } = setup(on, { global: CLAUDE, repos: { [HOME]: repoWith(PADDY) } })
  const result = await bash($, 'git commit -m x')
  expect(result.deny).toBeDefined()
  expect(seen).toHaveLength(0)
  expect(result.deny).toContain('Alex Example <alex@example.com>')
})

test('the name is compared exactly, the email in any case', async ($, on) => {
  setup(on, { global: CLAUDE, repos: { [HOME]: repoWith({ name: 'paddy davies', email: 'paddy.davies@me.com' }) } })
  expect((await bash($, 'git commit -m x')).deny).toBeDefined()
})

test('a custom list also governs the push check', { options }, async ($, on) => {
  setup(on, { global: CLAUDE, repos: { [HOME]: repoWith({}, [commit('1111111aaaaaaa', ALEX), commit('2222222aaaaaaa', PADDY)]) } })
  const result = await bash($, 'git push')
  expect(result.deny).toBeDefined()
  expect(result.deny).toContain('2222222')
  expect(result.deny).not.toContain('1111111')
})

test('an empty list falls back to the defaults rather than blocking everything', { options: { allowList: [] } }, async ($, on) => {
  const { seen } = setup(on, { global: CLAUDE, repos: { [HOME]: repoWith({}) } })
  expect((await bash($, 'git commit -m x')).deny).toBeUndefined()
  expect(seen).toHaveLength(1)
})
