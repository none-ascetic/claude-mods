import { test, expect } from 'claude-code/testing'
import { CLAUDE, FORBIDDEN, HOME, PADDY, STRANGER, WORK, bash, fakeGit, repoWith, toolBeneath } from './support'

const ALLOW_LIST = 'Paddy Davies <paddy.davies@me.com>, Claude <noreply@anthropic.com>'

const setup = (on: any, world: Parameters<typeof fakeGit>[1]) => ({ ...fakeGit(on, world), seen: toolBeneath(on) })

const expectBlocked = (result: any, seen: any[]) => {
  expect(result.isError).toBe(true)
  expect(seen).toHaveLength(0)
  for (const word of FORBIDDEN) expect(result.text).not.toMatch(word)
}

test('a commit as Paddy is allowed, email in any case', async ($, on) => {
  const { seen } = setup(on, { global: CLAUDE, repos: { [HOME]: repoWith({ name: 'Paddy Davies', email: 'Paddy.Davies@Me.com' }) } })
  const result = await bash($, 'git commit -m x')
  expect(result.isError).toBeFalsy()
  expect(seen).toHaveLength(1)
})

test('a commit as Claude is allowed', async ($, on) => {
  const { seen } = setup(on, { global: CLAUDE, repos: { [HOME]: repoWith({}) } })
  await bash($, 'git commit -m x')
  expect(seen).toHaveLength(1)
})

test('a mix, author Paddy and committer Claude, is allowed', async ($, on) => {
  const { seen } = setup(on, { global: PADDY, repos: { [HOME]: repoWith({}) } })
  const result = await bash($, 'GIT_COMMITTER_NAME=Claude GIT_COMMITTER_EMAIL=noreply@anthropic.com git commit -m x')
  expect(result.isError).toBeFalsy()
  expect(seen).toHaveLength(1)
})

test('the work email is blocked and the message names it, the allow-list and the fix', async ($, on) => {
  const { seen } = setup(on, { global: PADDY, repos: { [HOME]: repoWith(WORK) } })
  const result = await bash($, 'git commit -m x')
  expectBlocked(result, seen)
  expect(result.text).toContain('paddy@dines.co.uk')
  expect(result.text).toContain(ALLOW_LIST)
  expect(result.text).toContain('Fix:')
})

test('an unknown identity is blocked', async ($, on) => {
  const { seen } = setup(on, { global: PADDY, repos: { [HOME]: repoWith(STRANGER) } })
  const result = await bash($, 'git commit -m x')
  expectBlocked(result, seen)
  expect(result.text).toContain('someone@example.com')
})

test('an empty identity is blocked', async ($, on) => {
  const { seen } = setup(on, { repos: { [HOME]: repoWith({}) } })
  const result = await bash($, 'git commit -m x')
  expectBlocked(result, seen)
  expect(result.text).toMatch(/no (git )?identity|not set/i)
})

test('23 Apr: a -c user.email override is blocked even when the repo config is fine, and the fix is to drop it', async ($, on) => {
  const { seen } = setup(on, { global: PADDY, repos: { [HOME]: repoWith(PADDY) } })
  const result = await bash($, 'git -c user.email="paddy@dines.co.uk" commit -m x')
  expectBlocked(result, seen)
  expect(result.text).toContain('paddy@dines.co.uk')
  expect(result.text).toMatch(/drop the .*override/i)
  expect(result.text).toContain('-c user.email=')
})

test('--author is honoured both ways', async ($, on) => {
  const { seen } = setup(on, { global: PADDY, repos: { [HOME]: repoWith(PADDY) } })
  const bad = await bash($, 'git commit --author="Someone <someone@example.com>" -m x')
  expectBlocked(bad, seen)
  expect(bad.text).toMatch(/drop the .*override/i)
  expect(bad.text).toContain('--author')
  const good = await bash($, 'git commit --author="Claude <noreply@anthropic.com>" -m x')
  expect(good.isError).toBeFalsy()
  expect(seen).toHaveLength(1)
})

test('inline GIT_AUTHOR_EMAIL is honoured both ways', async ($, on) => {
  const { seen } = setup(on, { global: CLAUDE, repos: { [HOME]: repoWith({}) } })
  const bad = await bash($, 'GIT_AUTHOR_EMAIL=paddy@dines.co.uk git commit -m x')
  expectBlocked(bad, seen)
  expect(bad.text).toMatch(/drop the .*override/i)
  const good = await bash($, 'GIT_AUTHOR_NAME="Paddy Davies" GIT_AUTHOR_EMAIL=paddy.davies@me.com git commit -m x')
  expect(good.isError).toBeFalsy()
  expect(seen).toHaveLength(1)
})

test('an exported override on an earlier line still counts', async ($, on) => {
  const { seen } = setup(on, { global: CLAUDE, repos: { [HOME]: repoWith({}) } })
  const result = await bash($, 'export GIT_COMMITTER_EMAIL=paddy@dines.co.uk\ngit commit -m x')
  expectBlocked(result, seen)
})

test('global fine: the fix unsets the repo override and never moves off Claude', async ($, on) => {
  const { seen } = setup(on, { global: CLAUDE, repos: { [HOME]: repoWith(WORK) } })
  const result = await bash($, 'git commit -m x')
  expectBlocked(result, seen)
  expect(result.text).toContain('git config --unset user.name; git config --unset user.email')
  expect(result.text).not.toContain('git config user.email paddy.davies@me.com')
})

test('global not fine: the fix sets the repo to Paddy', async ($, on) => {
  const { seen } = setup(on, { global: WORK, repos: { [HOME]: repoWith(WORK) } })
  const result = await bash($, 'git commit -m x')
  expectBlocked(result, seen)
  expect(result.text).toContain('git config user.name "Paddy Davies" && git config user.email paddy.davies@me.com')
})

test('no global identity at all: the fix sets the repo to Paddy', async ($, on) => {
  const { seen } = setup(on, { repos: { [HOME]: repoWith(STRANGER) } })
  const result = await bash($, 'git commit -m x')
  expectBlocked(result, seen)
  expect(result.text).toContain('git config user.name "Paddy Davies" && git config user.email paddy.davies@me.com')
})

for (const command of [
  'git commit --amend --no-edit',
  'git merge feature',
  'git rebase main',
  'git cherry-pick abc1234',
  'git revert abc1234',
  'git am patch.mbox',
  'git pull origin main',
  'git add -A && git commit -m x',
  'git -C /work/repo commit -m x',
]) {
  test(`every commit-creating command is checked: ${command}`, async ($, on) => {
    const { seen } = setup(on, { global: PADDY, repos: { [HOME]: repoWith(WORK) } })
    expectBlocked(await bash($, command), seen)
  })
}

test('git -C checks the repo it points at', async ($, on) => {
  const { seen } = setup(on, { global: CLAUDE, repos: { [HOME]: repoWith({}), '/work/other': repoWith(WORK) } })
  expectBlocked(await bash($, 'git -C /work/other commit -m x'), seen)
  expect((await bash($, 'git -C /work/repo commit -m x')).isError).toBeFalsy()
})

for (const command of [
  'git status',
  'git log --oneline',
  'git diff HEAD',
  'git config user.email paddy.davies@me.com',
  'git add -A && git status',
  'echo "see git push and git -c user.email=x"; echo done',
  'ls -la',
]) {
  test(`commands that create no commits pass straight through: ${command}`, async ($, on) => {
    const { calls, seen } = setup(on, { global: PADDY, repos: { [HOME]: repoWith(WORK) } })
    const result = await bash($, command)
    expect(result.isError).toBeFalsy()
    expect(seen).toHaveLength(1)
    expect(seen[0].command).toBe(command)
    expect(calls).toHaveLength(0)
  })
}

test('words inside a commit message do not trigger the push check or overrides', async ($, on) => {
  const { seen } = setup(on, { global: CLAUDE, repos: { [HOME]: repoWith({}) } })
  const result = await bash($, 'git commit -m "never git push or git -c user.email=paddy@dines.co.uk"')
  expect(result.isError).toBeFalsy()
  expect(seen).toHaveLength(1)
})
