import { test, expect } from 'claude-code/testing'
import { CLAUDE, FORBIDDEN, HOME, PADDY, STRANGER, WORK, bash, commit, fakeGit, repoWith, toolBeneath } from './support'

const setup = (on: any, world: Parameters<typeof fakeGit>[1]) => ({ ...fakeGit(on, world), seen: toolBeneath(on) })

test('a push carrying an unpushed work-email commit is blocked and lists its short SHA', async ($, on) => {
  const { seen } = setup(on, {
    global: CLAUDE,
    repos: {
      [HOME]: repoWith({}, [
        commit('bbbbbbb1111111', WORK, { parents: ['aaaaaaa2222222'] }),
        commit('aaaaaaa2222222', PADDY, { onRemote: true }),
      ]),
    },
  })
  const result = await bash($, 'git push origin main')
  expect(result.isError).toBe(true)
  expect(seen).toHaveLength(0)
  expect(result.text).toContain('bbbbbbb')
  expect(result.text).toContain('paddy@dines.co.uk')
  expect(result.text).not.toContain('aaaaaaa Paddy')
})

test('the push fix re-stamps only the unpushed commits and never forces anything', async ($, on) => {
  setup(on, {
    global: CLAUDE,
    repos: {
      [HOME]: repoWith({}, [
        commit('ccccccc1111111', WORK, { parents: ['bbbbbbb1111111'] }),
        commit('bbbbbbb1111111', WORK, { parents: ['aaaaaaa2222222'] }),
        commit('aaaaaaa2222222', PADDY, { onRemote: true }),
      ]),
    },
  })
  const result = await bash($, 'git push')
  expect(result.text).toContain("git rebase --exec 'git commit --amend --no-edit --reset-author' bbbbbbb^")
  for (const word of FORBIDDEN) expect(result.text).not.toMatch(word)
})

test('the push fix also corrects the identity first, by the same rule as a commit', async ($, on) => {
  setup(on, { global: CLAUDE, repos: { [HOME]: repoWith(WORK, [commit('bbbbbbb1111111', WORK, { parents: ['aaaaaaa2222222'] })]) } })
  const result = await bash($, 'git push')
  expect(result.text).toContain('git config --unset user.name; git config --unset user.email')
  expect(result.text).not.toContain('git config user.email paddy.davies@me.com')
})

test('a first commit with no parent is re-stamped with --root', async ($, on) => {
  setup(on, { global: PADDY, repos: { [HOME]: repoWith({}, [commit('bbbbbbb1111111', WORK)]) } })
  const result = await bash($, 'git push -u origin main')
  expect(result.text).toContain("git rebase --exec 'git commit --amend --no-edit --reset-author' --root")
})

test('commits already on a remote are ignored, including other people\'s', async ($, on) => {
  const { seen } = setup(on, {
    global: CLAUDE,
    repos: {
      [HOME]: repoWith({}, [
        commit('ddddddd1111111', CLAUDE, { parents: ['aaaaaaa2222222'] }),
        commit('aaaaaaa2222222', STRANGER, { onRemote: true }),
        commit('9999999', WORK, { onRemote: true }),
      ]),
    },
  })
  const result = await bash($, 'git push origin main')
  expect(result.isError).toBeFalsy()
  expect(seen).toHaveLength(1)
})

test('a push where every unpushed commit is on the list is allowed, a mix included', async ($, on) => {
  const { seen } = setup(on, {
    global: CLAUDE,
    repos: {
      [HOME]: repoWith({}, [
        commit('2222222aaaaaaa', { author: PADDY, committer: CLAUDE }, { parents: ['1111111aaaaaaa'] }),
        commit('1111111aaaaaaa', CLAUDE),
      ]),
    },
  })
  expect((await bash($, 'git push origin HEAD')).isError).toBeFalsy()
  expect(seen).toHaveLength(1)
})

test('an off-list committer alone is enough to block a push', async ($, on) => {
  const { seen } = setup(on, { global: CLAUDE, repos: { [HOME]: repoWith({}, [commit('1111111aaaaaaa', { author: PADDY, committer: WORK })]) } })
  const result = await bash($, 'git push')
  expect(result.isError).toBe(true)
  expect(seen).toHaveLength(0)
  expect(result.text).toContain('1111111')
})

test('deleting a remote branch sends no commits, so it is allowed', async ($, on) => {
  const { calls, seen } = setup(on, { global: CLAUDE, repos: { [HOME]: repoWith({}, [commit('1111111aaaaaaa', WORK)]) } })
  expect((await bash($, 'git push origin --delete old-branch')).isError).toBeFalsy()
  expect(seen).toHaveLength(1)
  expect(calls).toHaveLength(0)
})

test('git -C points the push check at the right repo', async ($, on) => {
  const { seen } = setup(on, { global: CLAUDE, repos: { [HOME]: repoWith({}), '/work/other': repoWith({}, [commit('1111111aaaaaaa', WORK)]) } })
  expect((await bash($, 'git -C /work/other push')).isError).toBe(true)
  expect(seen).toHaveLength(0)
})
