import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { currentProblem, checkCommit, checkPush } from './checks'
import type { Run } from './git'
import { COMMIT_COMMANDS, gitCalls, parseAllowList } from './rules'

const problem = atom({ plugin: 'identity-guard', key: 'problem' } as const, null)

export const register: Register = (on, options) => {
  const allowList = parseAllowList(options.allowList)

  on('session.start', async ($, e, next) => {
    const run: Run = (argv, init) => $.process.run(argv, init)
    const started = await next(e)
    const line = await currentProblem(run, allowList)
    await update($, problem, () => line)
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const run: Run = (argv, init) => $.process.run(argv, init)
    const done = await next(e)
    const line = await currentProblem(run, allowList)
    await update($, problem, () => line)
    return done
  })

  // Commits are checked from what the command says, pushes from what git recorded.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const run: Run = (argv, init) => $.process.run(argv, init)
    const calls = gitCalls(e.command)
    for (const call of calls) {
      const isCommit = COMMIT_COMMANDS.has(call.sub)
      if (!isCommit && call.sub !== 'push') continue
      const block = await (isCommit ? checkCommit : checkPush)(run, call, allowList)
      if (block === null) continue
      $.ui.toast(block.toast)
      return { deny: block.deny }
    }
    const ran = await next(e)
    if (calls.length > 0) {
      const line = await currentProblem(run, allowList)
      await update($, problem, () => line)
    }
    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const line = await read($, problem)
    if (e.props.hasSurvey || line === null) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return Box({ children: Text({ color: 'red', children: line }) })
  })
}
