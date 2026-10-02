// A small pretend git for the tests. Plugin tests have no real processes, so the
// test answers `process.run` itself. This models only what identity-guard asks of
// git: `var`, `config --global --get`, `rev-parse` and `log`. Anything else it is
// asked is a mistake in the mod, so it throws and the test fails loudly.

export type Ident = { name: string; email: string }
export type FakeCommit = {
  sha: string
  parents?: string[]
  author: Ident
  committer: Ident
  onRemote?: boolean
}
export type FakeRepo = { local?: Partial<Ident>; commits?: FakeCommit[]; authors?: Ident[] }
export type FakeWorld = {
  cwd?: string
  global?: Partial<Ident>
  repos: Record<string, FakeRepo>
}

export const PADDY: Ident = { name: 'Paddy Davies', email: 'paddy.davies@me.com' }
export const CLAUDE: Ident = { name: 'Claude', email: 'noreply@anthropic.com' }
export const WORK: Ident = { name: 'Paddy Davies', email: 'paddy@dines.co.uk' }
export const STRANGER: Ident = { name: 'Someone', email: 'someone@example.com' }

export const HOME = '/work/repo'

const resolve = (from: string, to: string) => (to.startsWith('/') ? to : `${from}/${to}`)

export const fakeGit = (on: any, world: FakeWorld) => {
  const calls: string[][] = []
  const toasts: string[] = []

  on('ui.toast', (_$: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  on('process.run', (_$: any, e: any) => {
    const argv: string[] = [...e.argv]
    calls.push(argv)
    const env: Record<string, string> = e.init?.env ?? {}
    let dir: string = e.init?.cwd ?? world.cwd ?? HOME
    const configured: Record<string, string> = {}

    const args = argv.slice(1)
    if (argv[0] !== 'git') throw new Error(`fake git: unexpected program ${argv[0]}`)
    while (args[0]?.startsWith('-')) {
      const flag = args.shift()
      if (flag === '-C') dir = resolve(dir, args.shift() ?? '')
      else if (flag?.startsWith('--git-dir=')) dir = flag.slice('--git-dir='.length).replace(/\/\.git$/, '')
      else if (flag === '-c') {
        const pair = args.shift() ?? ''
        const eq = pair.indexOf('=')
        configured[pair.slice(0, eq)] = pair.slice(eq + 1)
      } else throw new Error(`fake git: unexpected option ${flag}`)
    }
    const repo = world.repos[dir]
    const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '' } })
    const fail = (exitCode: number, stderr = '') => ({ value: { exitCode, stdout: '', stderr } })

    const sub = args.shift()
    if (sub === 'var') {
      const which = args[0]
      const role = which === 'GIT_AUTHOR_IDENT' ? 'author' : which === 'GIT_COMMITTER_IDENT' ? 'committer' : null
      if (role === null) throw new Error(`fake git: unexpected var ${which}`)
      const upper = role.toUpperCase()
      const name =
        env[`GIT_${upper}_NAME`] ?? configured[`${role}.name`] ?? configured['user.name'] ?? repo?.local?.name ?? world.global?.name
      const email =
        env[`GIT_${upper}_EMAIL`] ?? configured[`${role}.email`] ?? configured['user.email'] ?? repo?.local?.email ?? world.global?.email
      if (name === undefined || email === undefined) return fail(128, 'fatal: unable to auto-detect email address')
      return ok(`${name} <${email}> 1790974179 +0000\n`)
    }
    if (sub === 'config') {
      const [scope, get, key] = args
      if (scope !== '--global' || get !== '--get') throw new Error(`fake git: unexpected config ${args.join(' ')}`)
      const value = key === 'user.name' ? world.global?.name : key === 'user.email' ? world.global?.email : undefined
      return value ? ok(`${value}\n`) : fail(1)
    }
    if (sub === 'rev-parse') {
      if (args[0] !== '--is-inside-work-tree') throw new Error(`fake git: unexpected rev-parse ${args.join(' ')}`)
      return repo ? ok('true\n') : fail(128, 'fatal: not a git repository')
    }
    if (sub === 'log') {
      if (!repo) return fail(128, 'fatal: not a git repository')
      const pattern = args.find(a => a.startsWith('--author='))?.slice('--author='.length)
      if (pattern !== undefined) {
        const known = (repo.authors ?? []).find(a => a.name.toLowerCase().includes(pattern.toLowerCase()) || a.email.toLowerCase().includes(pattern.toLowerCase()))
        return known ? ok(`${known.name}\t${known.email}\n`) : ok()
      }
      if (!args.includes('--not') || !args.includes('--remotes')) {
        throw new Error(`fake git: log must be limited to commits not on a remote, got ${args.join(' ')}`)
      }
      const lines = (repo.commits ?? [])
        .filter(c => !c.onRemote)
        .map(c =>
          [c.sha.slice(0, 7), c.author.name, c.author.email, c.committer.name, c.committer.email, (c.parents ?? []).map(p => p.slice(0, 7)).join(' ')].join('\t'),
        )
      return ok(lines.join('\n') + (lines.length > 0 ? '\n' : ''))
    }
    throw new Error(`fake git: unexpected command ${argv.join(' ')}`)
  })

  return { calls, toasts }
}

// What arrives beneath the plugin: records each tool call and lets it through.
// `lookups` counts the git calls already made when each tool call arrived, so a
// test can tell the guard's checks apart from the band refreshing afterwards.
export const toolBeneath = (on: any, calls: string[][] = []) => {
  const seen: any[] & { lookups: number[] } = Object.assign([] as any[], { lookups: [] as number[] })
  on('tool.call', (_$: any, e: any) => {
    seen.push(e)
    seen.lookups.push(calls.length)
    return { result: {}, text: 'ok' }
  })
  return seen
}

export const bash = ($: any, command: string) => $.tool.call({ tool: 'Bash', command })

export const repoWith = (local: Partial<Ident>, commits: FakeCommit[] = []): FakeRepo => ({ local, commits })

export const commit = (sha: string, who: Ident | { author: Ident; committer: Ident }, extra: Partial<FakeCommit> = {}): FakeCommit => {
  const pair = 'author' in who ? who : { author: who, committer: who }
  return { sha, ...pair, ...extra }
}

// Words a deny message must never use: the cloud setup and pushed history are not ours to fight.
export const FORBIDDEN = [/force/i, /--force/i, /reset --hard/i, /filter-branch/i, /push -f\b/i]
