import { test, expect } from 'claude-code/testing'
import { CLAUDE, FORBIDDEN, HOME, PADDY, STRANGER, WORK, bash, commit, fakeGit, repoWith, toolBeneath } from './support'

const setup = (on: any, world: Parameters<typeof fakeGit>[1]) => {
  const git = fakeGit(on, world)
  return { ...git, seen: toolBeneath(on, git.calls) }
}

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
  expect(result.deny).toBeDefined()
  expect(seen).toHaveLength(0)
  expect(result.deny).toContain('bbbbbbb')
  expect(result.deny).toContain('paddy@dines.co.uk')
  expect(result.deny).not.toContain('aaaaaaa Paddy')
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
  expect(result.deny).toContain("git rebase --exec 'git commit --amend --no-edit --reset-author' aaaaaaa")
  for (const word of FORBIDDEN) expect(result.deny).not.toMatch(word)
})

test('the push fix also corrects the identity first, by the same rule as a commit', async ($, on) => {
  setup(on, { global: CLAUDE, repos: { [HOME]: repoWith(WORK, [commit('bbbbbbb1111111', WORK, { parents: ['aaaaaaa2222222'] })]) } })
  const result = await bash($, 'git push')
  expect(result.deny).toContain('git config --unset user.name; git config --unset user.email')
  expect(result.deny).not.toContain('git config user.email paddy.davies@me.com')
})

test('the re-stamp base is the pushed commit the unpushed ones hang off, even past a merge', async ($, on) => {
  setup(on, {
    global: CLAUDE,
    repos: {
      [HOME]: repoWith({}, [
        commit('4444444aaaaaaa', CLAUDE, { parents: ['2222222aaaaaaa', '3333333aaaaaaa'] }),
        commit('3333333aaaaaaa', WORK, { parents: ['1111111aaaaaaa'] }),
        commit('2222222aaaaaaa', CLAUDE, { parents: ['1111111aaaaaaa'] }),
        commit('1111111aaaaaaa', PADDY, { onRemote: true }),
      ]),
    },
  })
  const result = await bash($, 'git push')
  expect(result.deny).toContain("--reset-author' 1111111")
  expect(result.deny).not.toContain('3333333^')
})

test('when unpushed work hangs off two different pushed commits no single re-stamp is safe, so none is suggested', async ($, on) => {
  setup(on, {
    global: CLAUDE,
    repos: {
      [HOME]: repoWith({}, [
        commit('3333333aaaaaaa', WORK, { parents: ['1111111aaaaaaa', '2222222aaaaaaa'] }),
        commit('1111111aaaaaaa', PADDY, { onRemote: true }),
        commit('2222222aaaaaaa', PADDY, { onRemote: true }),
      ]),
    },
  })
  const result = await bash($, 'git push')
  expect(result.deny).toContain('3333333')
  expect(result.deny).not.toContain('git rebase')
  expect(result.deny).toMatch(/merge/i)
  for (const word of FORBIDDEN) expect(result.deny).not.toMatch(word)
})

test('a first commit with no parent is re-stamped with --root', async ($, on) => {
  setup(on, { global: PADDY, repos: { [HOME]: repoWith({}, [commit('bbbbbbb1111111', WORK)]) } })
  const result = await bash($, 'git push -u origin main')
  expect(result.deny).toContain("git rebase --exec 'git commit --amend --no-edit --reset-author' --root")
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
  expect(result.deny).toBeUndefined()
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
  expect((await bash($, 'git push origin HEAD')).deny).toBeUndefined()
  expect(seen).toHaveLength(1)
})

test('an off-list committer alone is enough to block a push', async ($, on) => {
  const { seen } = setup(on, { global: CLAUDE, repos: { [HOME]: repoWith({}, [commit('1111111aaaaaaa', { author: PADDY, committer: WORK })]) } })
  const result = await bash($, 'git push')
  expect(result.deny).toBeDefined()
  expect(seen).toHaveLength(0)
  expect(result.deny).toContain('1111111')
})

test('deleting a remote branch sends no commits, so it is allowed', async ($, on) => {
  const { seen } = setup(on, { global: CLAUDE, repos: { [HOME]: repoWith({}, [commit('1111111aaaaaaa', WORK)]) } })
  expect((await bash($, 'git push origin --delete old-branch')).deny).toBeUndefined()
  expect(seen).toHaveLength(1)
  expect(seen.lookups).toEqual([0])
})

test('git -C points the push check at the right repo', async ($, on) => {
  const { seen } = setup(on, { global: CLAUDE, repos: { [HOME]: repoWith({}), '/work/other': repoWith({}, [commit('1111111aaaaaaa', WORK)]) } })
  expect((await bash($, 'git -C /work/other push')).deny).toBeDefined()
  expect(seen).toHaveLength(0)
})

const OFF = (): Parameters<typeof fakeGit>[1] => ({ global: CLAUDE, repos: { [HOME]: repoWith({}, [commit('1111111aaaaaaa', WORK)]) } })

for (const command of [
  'git push origin main 2>&1',
  'git push origin main > out.log',
  'git push origin main >> out.log 2>&1',
  'git push \\\n  origin main',
  'cd /work/repo && git push',
  '(git push)',
  'time git push',
]) {
  test(`redirects, continuations and wrappers do not hide a push: ${command}`, async ($, on) => {
    const { seen } = setup(on, OFF())
    expect((await bash($, command)).deny).toBeDefined()
    expect(seen).toHaveLength(0)
  })
}

test('--tags, --follow-tags, glob refspecs and --mirror widen what is checked', async ($, on) => {
  const { calls } = setup(on, OFF())
  const widest = async (command: string) => {
    calls.length = 0
    await bash($, command)
    return calls.find(c => c.includes('log'))
  }
  expect(await widest('git push --tags')).toContain('--tags')
  expect(await widest('git push --follow-tags origin main')).toContain('--tags')
  expect(await widest("git push origin 'refs/heads/*:refs/heads/*'")).toContain('--branches')
  expect(await widest('git push --mirror')).toContain('--all')
})

test('a dry run sends nothing, so it is allowed', async ($, on) => {
  const { seen } = setup(on, OFF())
  expect((await bash($, 'git push --dry-run')).deny).toBeUndefined()
  expect(seen.lookups).toEqual([0])
})
