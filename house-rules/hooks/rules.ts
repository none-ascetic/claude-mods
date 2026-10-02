// Pure rules for the House Rules mod: no engine calls in here, so the
// hooks in register.ts stay thin and every rule is easy to read.

const EM = '\u2014'
const EN = '\u2013'

const isBlank = (c: string) => c !== '\n' && c !== '\r' && /\s/.test(c)

/**
 * Swaps em dashes (and spaced en dashes) for a spaced hyphen as text
 * arrives in pieces. Whitespace around a dash collapses to exactly one
 * space either side. Unspaced en dashes (2-3 days) are left alone. With
 * `respectFences`, fenced code blocks are left alone, even when a fence
 * marker or a dash is split across pieces.
 *
 * Trailing whitespace is held back until the next piece shows whether a
 * dash follows; `flush()` releases whatever is held.
 */
export class DashSwapper {
  private inFence = false
  private fenceLine = false
  private lineHead = ''
  private lineHasContent = false
  private pendingWs = ''
  private pendingEn = false
  private afterDash = false

  constructor(private readonly respectFences: boolean) {}

  push(text: string): string {
    let out = ''
    for (const c of text) out += this.step(c)
    return out
  }

  flush(): string {
    const out = this.pendingWs + (this.pendingEn ? EN : '')
    this.pendingWs = ''
    this.pendingEn = false
    this.afterDash = false
    return out
  }

  private step(c: string): string {
    if (c === '\n' || c === '\r') {
      const out = this.flush() + c
      if (c === '\n') {
        this.lineHead = ''
        this.fenceLine = false
        this.lineHasContent = false
      }
      return out
    }
    if (isBlank(c)) {
      if (this.afterDash) return ''
      if (this.pendingEn) {
        this.pendingEn = false
        return this.emitDash()
      }
      this.pendingWs += c
      return ''
    }

    let out = ''
    if (this.pendingEn) {
      out += this.pendingWs + EN
      this.pendingWs = ''
      this.pendingEn = false
      this.noteChar(EN)
    }
    const canSwap = !this.respectFences || (!this.inFence && !this.fenceLine)
    if (c === EM && canSwap) {
      return this.afterDash ? out : out + this.emitDash()
    }
    if (c === EN && canSwap && this.pendingWs !== '' && !this.afterDash) {
      this.pendingEn = true
      return out
    }
    if (this.afterDash) {
      out += ' '
      this.afterDash = false
    }
    out += this.pendingWs + c
    this.pendingWs = ''
    this.noteChar(c)
    return out
  }

  // " -" mid-line; at the start of a line the indentation is kept and the
  // hyphen follows it directly. The single space after is added lazily, by
  // whatever comes next on the line.
  private emitDash(): string {
    const lead = this.lineHasContent ? ' ' : this.pendingWs
    this.pendingWs = ''
    this.afterDash = true
    this.noteChar('-')
    return `${lead}-`
  }

  private noteChar(c: string) {
    this.lineHasContent = true
    if (this.lineHead.length >= 3) return
    this.lineHead += c
    if (this.lineHead.length === 3 && /^(`{3}|~{3})$/.test(this.lineHead)) {
      this.inFence = !this.inFence
      this.fenceLine = true
    }
  }
}

/** Swaps every em dash in a whole string. */
export const swapDashes = (text: string, respectFences = false): string => {
  if (!text.includes(EM) && !text.includes(EN)) return text
  const swapper = new DashSwapper(respectFences)
  return swapper.push(text) + swapper.flush()
}

/** Swaps em dashes in every string field of a value, however deeply nested. */
export const swapDeep = <T>(value: T): T => {
  if (typeof value === 'string') return swapDashes(value) as T
  if (Array.isArray(value)) return value.map(swapDeep) as T
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = swapDeep(v)
    return out as T
  }
  return value
}

// ---------------------------------------------------------------- files

const DASH = new RegExp(`${EM}|(?<=\\s)${EN}(?=\\s)`, 'g')

const dashesIn = (line: string) => line.match(DASH)?.length ?? 0

export type DashLine = { line: number; text: string }

/**
 * The em dashes `newText` adds on top of `oldText`: how many, and which
 * lines carry them (a line that already exists in the old text, dashes and
 * all, is not an addition). `firstLine` is the file line `newText` starts on.
 */
export const addedDashes = (oldText: string, newText: string, firstLine = 1) => {
  const oldLines = new Map<string, number>()
  let oldTotal = 0
  for (const l of oldText.split('\n')) {
    const n = dashesIn(l)
    if (n === 0) continue
    oldTotal += n
    oldLines.set(l, (oldLines.get(l) ?? 0) + 1)
  }
  let newTotal = 0
  const lines: DashLine[] = []
  newText.split('\n').forEach((l, i) => {
    const n = dashesIn(l)
    if (n === 0) return
    newTotal += n
    const kept = oldLines.get(l) ?? 0
    if (kept > 0) oldLines.set(l, kept - 1)
    else lines.push({ line: firstLine + i, text: l.trim() })
  })
  return { count: Math.max(0, newTotal - oldTotal), lines }
}

const snippet = (text: string) => (text.length > 80 ? `${text.slice(0, 77)}...` : text)

export const repunctuateMessage = (count: number, lines: readonly DashLine[]) => {
  const where = lines.map(l => `line ${l.line}: '${snippet(l.text)}'`).join('; ')
  return (
    `This adds ${count} em dash${count === 1 ? '' : 'es'} (${where}). ` +
    'Repunctuate: commas, full stops, colons, semicolons or restructure the sentence ' +
    "(a spaced hyphen ' - ' only in text written in Paddy's voice). " +
    'Em dashes already in the file are fine; just do not add new ones.'
  )
}

const globToRegExp = (glob: string, anchored: boolean) => {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i)
    if (c === '*' && glob.charAt(i + 1) === '*') {
      re += '.*'
      i++
    } else if (c === '*') re += anchored ? '[^/]*' : '.*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return re
}

/** True when `path` matches any exempt glob (`docs/quotes/*.md` matches anywhere in the path). */
export const isExemptPath = (path: string, globs: readonly string[]): boolean =>
  globs.some(g => new RegExp(`(^|/)${globToRegExp(g.replace(/^\.?\//, ''), true)}$`).test(path))

// ------------------------------------------------------------- outbound

// `*` is a wildcard. The server part is a wildcard too, so these match
// however the connector happens to be named in a session.
export const DEFAULT_OUTBOUND_TOOLS: readonly string[] = [
  // Gmail
  'mcp__*__create_draft',
  'mcp__*__update_draft',
  'mcp__*__send_message',
  'mcp__*__reply',
  'mcp__*__forward',
  // Slack
  'mcp__*__slack_send_message',
  'mcp__*__slack_send_message_draft',
  'mcp__*__slack_schedule_message',
  'mcp__*__slack_create_canvas',
  'mcp__*__slack_update_canvas',
  // GitHub
  'mcp__*__issue_write',
  'mcp__*__add_issue_comment',
  'mcp__*__update_issue_comment',
  'mcp__*__create_pull_request',
  'mcp__*__update_pull_request',
  'mcp__*__pull_request_review_write',
  'mcp__*__add_comment_to_pending_review',
  'mcp__*__add_reply_to_pull_request_comment',
  // Plain
  'mcp__*__replyToThread',
  'mcp__*__createNote',
  'mcp__*__addGeneratedReply',
  // ClickUp
  'mcp__*__clickup_create_comment',
  'mcp__*__clickup_create_task_comment',
  'mcp__*__clickup_update_comment',
]

export const outboundMatcher = (patterns: readonly string[]): RegExp =>
  new RegExp(`^(?:${patterns.map(p => globToRegExp(p, false)).join('|')})$`, 'i')

// --------------------------------------------------------------- length

/** Words of prose: fenced code blocks and table rows do not count. */
export const proseWords = (text: string): number => {
  let inFence = false
  let words = 0
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (/^(```|~~~)/.test(t)) {
      inFence = !inFence
      continue
    }
    if (inFence || t.startsWith('|')) continue
    words += t.split(/\s+/).filter(Boolean).length
  }
  return words
}
