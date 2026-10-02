import { test, expect } from 'claude-code/testing'
import { CLAUDE, HOME, PADDY, WORK, bash, fakeGit, repoWith, toolBeneath } from './support'
import type { FakeWorld } from './support'

const SURFACES = ['terminal', 'desktop'] as const
const PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 } as any

const start = ($: any, on: any) => {
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as any)
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  return (surface: 'terminal' | 'desktop') => $.session.start({ cwd: HOME, surface, isInteractive: true })
}

const drawn = async ($: any, surface: 'terminal' | 'desktop') => {
  const ui = await $.ui.mount({ plugin: 'identity-guard', surface, component: 'AbovePrompt', props: PROPS })
  const line = await ui.find({ type: 'Text', text: /✗/ })
  await ui.unmount()
  return line
}

for (const surface of SURFACES) {
  test(`the band draws one red line for an off-list identity on ${surface}`, async ($, on) => {
    fakeGit(on, { global: CLAUDE, repos: { [HOME]: repoWith(WORK) } })
    await start($, on)(surface)
    const line = await drawn($, surface)
    expect(line).toBeDefined()
    expect(line?.text).toContain('paddy@dines.co.uk')
  })

  test(`the band draws nothing for an on-list identity on ${surface}`, async ($, on) => {
    fakeGit(on, { global: CLAUDE, repos: { [HOME]: repoWith(PADDY) } })
    await start($, on)(surface)
    expect(await drawn($, surface)).toBeUndefined()
  })

  test(`the band draws nothing outside a git repo on ${surface}`, async ($, on) => {
    fakeGit(on, { global: CLAUDE, repos: {} })
    await start($, on)(surface)
    expect(await drawn($, surface)).toBeUndefined()
  })
}

test('the band refreshes after a git-touching Bash call', async ($, on) => {
  const world: FakeWorld = { global: CLAUDE, repos: { [HOME]: repoWith(PADDY) } }
  fakeGit(on, world)
  toolBeneath(on)
  await start($, on)('terminal')
  expect(await drawn($, 'terminal')).toBeUndefined()
  world.repos[HOME] = repoWith(WORK)
  await bash($, 'git config user.email paddy@dines.co.uk')
  expect(await drawn($, 'terminal')).toBeDefined()
  world.repos[HOME] = repoWith(PADDY)
  await bash($, 'git config user.email paddy.davies@me.com')
  expect(await drawn($, 'terminal')).toBeUndefined()
})

test('the band refreshes when a turn completes', async ($, on) => {
  const world: FakeWorld = { global: CLAUDE, repos: { [HOME]: repoWith(PADDY) } }
  fakeGit(on, world)
  on('turn.complete', () => ({ text: '' }))
  await start($, on)('terminal')
  world.repos[HOME] = repoWith(WORK)
  await $.turn.complete({ reason: 'answer', answer: 'done' } as any)
  expect(await drawn($, 'terminal')).toBeDefined()
})

test('a blocked commit shows a toast', async ($, on) => {
  fakeGit(on, { global: CLAUDE, repos: { [HOME]: repoWith(WORK) } })
  toolBeneath(on)
  const toasts: string[] = []
  on('ui.toast', (_$: any, e: any) => {
    toasts.push(e.text)
    return undefined as never
  })
  await bash($, 'git commit -m x')
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('paddy@dines.co.uk')
})

test('a commit that goes through shows nothing', async ($, on) => {
  fakeGit(on, { global: CLAUDE, repos: { [HOME]: repoWith(PADDY) } })
  toolBeneath(on)
  const toasts: string[] = []
  on('ui.toast', (_$: any, e: any) => {
    toasts.push(e.text)
    return undefined as never
  })
  await bash($, 'git commit -m x')
  expect(toasts).toHaveLength(0)
})
