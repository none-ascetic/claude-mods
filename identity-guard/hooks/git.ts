// What identity-guard asks of git. Each function takes `run`, a way to run a
// command, so the hooks stay the only place that touches the engine.
import { type GitCall, type Found, type Ident, type Unpushed, isAllowed, parseIdent } from './rules'

export type Run = (
  argv: readonly string[],
  init?: { env?: Record<string, string>; cwd?: string },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>

const IDENT_LINE = /^(.*) <(.*)> \d+ [+-]\d{4}$/s

const identOf = async (run: Run, prefix: readonly string[], env: Record<string, string>, role: 'AUTHOR' | 'COMMITTER') => {
  const done = await run(['git', ...prefix, 'var', `GIT_${role}_IDENT`], Object.keys(env).length > 0 ? { env } : undefined)
  if (done.exitCode !== 0) return null
  const found = IDENT_LINE.exec(done.stdout.trim())
  return found ? { name: found[1] ?? '', email: found[2] ?? '' } : null
}

// The identity git would use for this command: its own config plus what the command overrides.
export const commitIdentity = async (run: Run, call: GitCall): Promise<Found> => {
  const prefix = [...call.prefix, ...call.identityPrefix]
  const [author, committer] = await Promise.all([
    identOf(run, prefix, call.envOverrides, 'AUTHOR'),
    identOf(run, prefix, call.envOverrides, 'COMMITTER'),
  ])
  return { author: call.authorOverride === null ? author : parseIdent(call.authorOverride), committer }
}

// The identity git would use with every override in the command dropped.
export const baselineIdentity = async (run: Run, prefix: readonly string[]): Promise<Found> => {
  const [author, committer] = await Promise.all([identOf(run, prefix, {}, 'AUTHOR'), identOf(run, prefix, {}, 'COMMITTER')])
  return { author, committer }
}

export const isIdentityAllowed = (found: Found, allowList: readonly Ident[]) => isAllowed(found.author, allowList) && isAllowed(found.committer, allowList)

// Whether the global identity, which a repo falls back to once its own is removed, is on the list.
export const isGlobalAllowed = async (run: Run, allowList: readonly Ident[]): Promise<boolean> => {
  const [name, email] = await Promise.all([
    run(['git', 'config', '--global', '--get', 'user.name']),
    run(['git', 'config', '--global', '--get', 'user.email']),
  ])
  if (name.exitCode !== 0 || email.exitCode !== 0) return false
  return isAllowed({ name: name.stdout.trim(), email: email.stdout.trim() }, allowList)
}

export const isInsideRepo = async (run: Run): Promise<boolean> =>
  (await run(['git', 'rev-parse', '--is-inside-work-tree'])).exitCode === 0

// Commits on the pushed refs that no remote has yet, newest first.
export const unpushedCommits = async (run: Run, prefix: readonly string[], refs: readonly string[]): Promise<Unpushed[]> => {
  const done = await run(['git', ...prefix, 'log', ...refs, '--not', '--remotes', '--format=%h%x09%an%x09%ae%x09%cn%x09%ce%x09%p'])
  if (done.exitCode !== 0) return []
  return done.stdout
    .split('\n')
    .filter(line => line !== '')
    .map(line => {
      const [sha = '', an = '', ae = '', cn = '', ce = '', parents = ''] = line.split('\t')
      return { sha, author: { name: an, email: ae }, committer: { name: cn, email: ce }, isRoot: parents.trim() === '' }
    })
}
