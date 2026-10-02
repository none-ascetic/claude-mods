// Pure rules: no engine, no processes. Reading what a shell command says it will
// do to git's identity, comparing identities with the allow-list, and wording the
// messages Claude is told.

export type Ident = { name: string; email: string }

export const DEFAULT_ALLOW_LIST = ['Paddy Davies <paddy.davies@me.com>', 'Claude <noreply@anthropic.com>']

const IDENT = /^\s*(.*?)\s*<([^<>]*)>\s*$/

export const parseIdent = (text: string): Ident | null => {
  const found = IDENT.exec(text)
  return found && { name: found[1] ?? '', email: found[2] ?? '' }
}

// Settings give a list, but a single comma-separated string is accepted too.
export const parseAllowList = (value: unknown): Ident[] => {
  const entries = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/(?<=>)\s*,\s*/) : []
  const parsed = entries.flatMap(entry => {
    const ident = typeof entry === 'string' ? parseIdent(entry) : null
    return ident && ident.email !== '' ? [ident] : []
  })
  return parsed.length > 0 ? parsed : DEFAULT_ALLOW_LIST.flatMap(entry => parseIdent(entry) ?? [])
}

export const isAllowed = (ident: Ident | null, allowList: readonly Ident[]): boolean =>
  ident !== null && allowList.some(a => a.name === ident.name && a.email.toLowerCase() === ident.email.toLowerCase())

export const show = (ident: Ident | null): string => (ident === null ? 'no identity set' : `${ident.name} <${ident.email}>`)

export const showList = (allowList: readonly Ident[]): string => allowList.map(show).join(', ')

// ---- reading a shell command -------------------------------------------------

const OPERATORS = ['&&', '||', ';', '|', '&', '\n']

// Splits at unquoted operators and into words, honouring quotes and backslashes.
export const splitCommand = (command: string): string[][] => {
  const segments: string[][] = []
  let words: string[] = []
  let word = ''
  let hasWord = false
  let quote: '"' | "'" | null = null
  const endWord = () => {
    if (hasWord) words.push(word)
    word = ''
    hasWord = false
  }
  const endSegment = () => {
    endWord()
    if (words.length > 0) segments.push(words)
    words = []
  }
  for (let i = 0; i < command.length; i++) {
    const c = command.charAt(i)
    if (quote !== null) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && i + 1 < command.length) word += command.charAt(++i)
      else word += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      hasWord = true
    } else if (c === '\\' && i + 1 < command.length) {
      word += command.charAt(++i)
      hasWord = true
    } else if (c === ' ' || c === '\t') endWord()
    else {
      const op = OPERATORS.find(o => command.startsWith(o, i))
      if (op === undefined) {
        word += c
        hasWord = true
      } else {
        endSegment()
        i += op.length - 1
      }
    }
  }
  endSegment()
  return segments
}

const IDENTITY_CONFIG = new Set(['user.name', 'user.email', 'author.name', 'author.email', 'committer.name', 'committer.email'])
const IDENTITY_ENV = new Set(['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'])
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s
const WITH_ARGUMENT = new Set(['--namespace', '--exec-path'])

export const COMMIT_COMMANDS = new Set(['commit', 'merge', 'rebase', 'cherry-pick', 'revert', 'am', 'pull'])

export type GitCall = {
  sub: string
  args: string[]
  // Options that belong in front of any further git command run for this one: -C, --git-dir, -c (not identity ones).
  prefix: string[]
  // What the command writes over git's identity, each as it was written.
  configOverrides: string[]
  envOverrides: Record<string, string>
  authorOverride: string | null
  // The identity -c options, ready to pass to `git var`.
  identityPrefix: string[]
}

export const identityOverrides = (call: GitCall): string[] => [
  ...call.configOverrides.map(kv => `-c ${kv}`),
  ...(call.authorOverride === null ? [] : [`--author=${call.authorOverride}`]),
  ...Object.entries(call.envOverrides).map(([k, v]) => `${k}=${v}`),
]

// Every git invocation in the command, in order. Assignments on a line of their
// own (or after `export`) carry forward to later lines, as the shell does.
export const gitCalls = (command: string): GitCall[] => {
  const calls: GitCall[] = []
  const carried: Record<string, string> = {}
  for (const words of splitCommand(command)) {
    let i = 0
    const inline: Record<string, string> = {}
    if (words[0] === 'export') i = 1
    const isExport = i === 1
    for (; i < words.length; i++) {
      const assigned = ASSIGNMENT.exec(words[i] ?? '')
      if (assigned === null) break
      ;(isExport ? carried : inline)[assigned[1] ?? ''] = assigned[2] ?? ''
    }
    if (i >= words.length) {
      Object.assign(carried, inline)
      continue
    }
    while (words[i] === 'env' || words[i] === 'command') i++
    const program = words[i] ?? ''
    if (program !== 'git' && !program.endsWith('/git')) continue
    i++

    const prefix: string[] = []
    const identityPrefix: string[] = []
    const configOverrides: string[] = []
    while (i < words.length && (words[i] ?? '').startsWith('-')) {
      const flag = words[i] ?? ''
      if (flag === '-C' || flag === '-c') {
        const value = words[i + 1] ?? ''
        if (flag === '-C') prefix.push(flag, value)
        else if (IDENTITY_CONFIG.has(value.slice(0, Math.max(value.indexOf('='), 0)).toLowerCase())) {
          configOverrides.push(value)
          identityPrefix.push(flag, value)
        } else prefix.push(flag, value)
        i += 2
      } else if (WITH_ARGUMENT.has(flag)) i += 2
      else {
        if (flag.startsWith('--git-dir=') || flag.startsWith('--work-tree=')) prefix.push(flag)
        i += 1
      }
    }
    const sub = words[i] ?? ''
    const args = words.slice(i + 1)

    const envOverrides: Record<string, string> = {}
    for (const [k, v] of Object.entries({ ...carried, ...inline })) if (IDENTITY_ENV.has(k)) envOverrides[k] = v

    let authorOverride: string | null = null
    if (sub === 'commit') {
      args.forEach((arg, n) => {
        if (arg.startsWith('--author=')) authorOverride = arg.slice('--author='.length)
        else if (arg === '--author') authorOverride = args[n + 1] ?? ''
      })
    }
    calls.push({ sub, args, prefix, identityPrefix, configOverrides, envOverrides, authorOverride })
  }
  return calls
}

const PUSH_VALUE_OPTIONS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec'])

// The refs a push sends, as git log can name them. null: nothing to check.
export const pushedRefs = (args: readonly string[]): string[] | null => {
  const positional: string[] = []
  let isAll = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    if (arg === '--delete' || arg === '-d') return null
    if (arg === '--all' || arg === '--mirror') isAll = true
    else if (PUSH_VALUE_OPTIONS.has(arg)) i++
    else if (!arg.startsWith('-')) positional.push(arg)
  }
  if (isAll) return ['--branches']
  const refspecs = positional.slice(1)
  if (refspecs.length === 0) return ['HEAD']
  const refs = refspecs.flatMap(spec => {
    const src = spec.replace(/^\+/, '').split(':')[0] ?? ''
    return src === '' || src.includes('*') || src === 'tag' ? [] : [src]
  })
  return refs.length > 0 ? refs : null
}

// ---- wording ------------------------------------------------------------------

export type Found = { author: Ident | null; committer: Ident | null }

export const offences = (found: Found, allowList: readonly Ident[]): string[] => {
  const isAuthorBad = !isAllowed(found.author, allowList)
  const isCommitterBad = !isAllowed(found.committer, allowList)
  if (isAuthorBad && isCommitterBad && show(found.author) === show(found.committer)) {
    return [`the author and committer ${show(found.author)}`]
  }
  return [
    ...(isAuthorBad ? [`the author ${show(found.author)}`] : []),
    ...(isCommitterBad ? [`the committer ${show(found.committer)}`] : []),
  ]
}

export const SET_PADDY = 'git config user.name "Paddy Davies" && git config user.email paddy.davies@me.com'
export const UNSET_LOCAL = 'git config --unset user.name; git config --unset user.email'

// How to make this repo's own identity right. Where the global identity is on
// the list the repo falls back to it (Claude in the cloud, Paddy on the laptop),
// so the fix never moves anyone off the identity their setup requires.
export const identityFix = (isGlobalAllowed: boolean): string =>
  isGlobalAllowed
    ? `remove this repo's override: \`${UNSET_LOCAL}\``
    : `set this repo to Paddy: \`${SET_PADDY}\``

export const commitMessage = (args: {
  found: Found
  allowList: readonly Ident[]
  overrides: string[]
  isBaselineAllowed: boolean
  isGlobalAllowed: boolean
}): string => {
  const { found, allowList, overrides, isBaselineAllowed, isGlobalAllowed } = args
  const steps: string[] = []
  if (overrides.length > 0) steps.push(`Drop the override from the command (${overrides.map(o => `\`${o}\``).join(', ')}).`)
  if (!isBaselineAllowed) steps.push(`${capital(identityFix(isGlobalAllowed))}.`)
  return [
    `Blocked: this commit would have author ${show(found.author)} and committer ${show(found.committer)}.`,
    `Not on the allow-list (${showList(allowList)}): ${offences(found, allowList).join(' and ')}.`,
    `Fix: ${numbered(steps)}`,
  ].join('\n')
}

export type Unpushed = { sha: string; author: Ident; committer: Ident; isRoot: boolean }

export const pushMessage = (args: {
  bad: Unpushed[]
  oldest: Unpushed
  total: number
  allowList: readonly Ident[]
  isIdentityAllowed: boolean
  isGlobalAllowed: boolean
}): string => {
  const { bad, oldest, total, allowList, isIdentityAllowed, isGlobalAllowed } = args
  const base = oldest.isRoot ? '--root' : `${oldest.sha}^`
  const restamp = `git rebase --exec 'git commit --amend --no-edit --reset-author' ${base}`
  const steps = [
    ...(isIdentityAllowed ? [] : [`${capital(identityFix(isGlobalAllowed))}.`]),
    `Re-stamp the ${total} unpushed commit${total === 1 ? '' : 's'} only: \`${restamp}\`. Commits already on a remote are never touched.`,
  ]
  return [
    `Blocked: ${bad.length} commit${bad.length === 1 ? '' : 's'} about to be pushed ${bad.length === 1 ? 'has' : 'have'} an identity that isn't on the allow-list (${showList(allowList)}):`,
    ...bad.map(c => `  ${c.sha}  author ${show(c.author)}, committer ${show(c.committer)}`),
    `Fix: ${numbered(steps)}`,
  ].join('\n')
}

const numbered = (steps: string[]) =>
  steps.length === 1 ? (steps[0] ?? '') : steps.map((step, n) => `${n + 1}. ${step}`).join(' ')

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
