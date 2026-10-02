// Pure rules for the House Rules mod: no engine calls in here, so the
// hooks in register.ts stay thin and every rule is easy to read.

const EM = '\u2014'
const EN = '\u2013'

type Fence = { char: string; length: number }

/** The fence a run of backticks or tildes makes: three or more, else none. */
const fenceMarker = (run: string): Fence | null =>
  run.length >= 3 ? { char: run.charAt(0), length: run.length } : null

const closesFence = (open: Fence, marker: Fence) =>
  marker.char === open.char && marker.length >= open.length

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
  private fence: Fence | null = null
  private fenceLine = false
  private run = ''
  private runOpen = true
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
      const wasSpaced = this.pendingEn && this.pendingWs !== ''
      if (wasSpaced) this.pendingEn = false
      const out = (wasSpaced ? this.emitDash() : '') + this.flush() + c
      if (c === '\n') this.startLine()
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
    const canSwap = !this.respectFences || (this.fence === null && !this.fenceLine)
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

  // A fence line starts with a run of three or more backticks or tildes. The
  // run is known only once it ends, so the line's dashes (after the run) are
  // judged then. A fence closes on a run of the same character, at least as
  // long as the opening one.
  private noteChar(c: string) {
    this.lineHasContent = true
    if (!this.runOpen) return
    if ((c === '`' || c === '~') && (this.run === '' || this.run.startsWith(c))) {
      this.run += c
      return
    }
    this.endOfLine()
  }

  private startLine() {
    this.endOfLine()
    this.fenceLine = false
    this.run = ''
    this.runOpen = true
    this.lineHasContent = false
  }

  private endOfLine() {
    if (!this.runOpen) return
    this.runOpen = false
    const marker = fenceMarker(this.run)
    if (marker === null) return
    if (this.fence === null) {
      this.fence = marker
      this.fenceLine = true
    } else if (closesFence(this.fence, marker)) {
      this.fence = null
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

/** The cheap check before any file is read: no dash character at all means nothing to guard. */
export const mayHaveDash = (text: string): boolean => text.includes(EM) || text.includes(EN)

type DashLine = { line: number; text: string }

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

const globToRegExp = (glob: string, isSingleSegment: boolean) => {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i)
    if (c === '*' && glob.charAt(i + 1) === '*') {
      const isDirs = glob.charAt(i + 2) === '/'
      re += isDirs ? '(?:.*/)?' : '.*'
      i += isDirs ? 2 : 1
    } else if (c === '*') re += isSingleSegment ? '[^/]*' : '.*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return re
}

/** Compiles exempt globs once; `docs/quotes/*.md` matches anywhere in a path. */
export const exemptMatcher = (globs: readonly string[]): ((path: string) => boolean) => {
  if (globs.length === 0) return () => false
  const re = new RegExp(`(^|/)(?:${globs.map(g => globToRegExp(g.replace(/^\.?\//, ''), true)).join('|')})$`)
  return path => re.test(path)
}

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
  'mcp__*__reply_to_message',
  'mcp__*__forward_message',
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
  'mcp__*__createThread',
  // ClickUp
  'mcp__*__clickup_create_comment',
  'mcp__*__clickup_create_task_comment',
  'mcp__*__clickup_update_comment',
  'mcp__*__clickup_send_chat_message',
  'mcp__*__clickup_create_task',
  'mcp__*__clickup_update_task',
]

export const outboundMatcher = (patterns: readonly string[]): RegExp =>
  new RegExp(`^(?:${patterns.map(p => globToRegExp(p, false)).join('|')})$`, 'i')

// --------------------------------------------------------------- length

/** Words of prose: fenced code blocks and table rows do not count. */
export const proseWords = (text: string): number => {
  let fence: Fence | null = null
  let words = 0
  for (const line of text.split('\n')) {
    const t = line.trim()
    const marker = fenceMarker(/^(`+|~+)/.exec(t)?.[0] ?? '')
    if (marker !== null) {
      if (fence === null) fence = marker
      else if (closesFence(fence, marker)) fence = null
      continue
    }
    if (fence !== null || t.startsWith('|')) continue
    words += t.split(/\s+/).filter(Boolean).length
  }
  return words
}

/**
 * The source of one notebook cell, so an edit can be compared with what the
 * cell held before. Anything unreadable counts as an empty cell.
 */
export const notebookCellSource = (notebookJson: string, cellId: string | undefined): string => {
  try {
    const cells: unknown = JSON.parse(notebookJson)?.cells
    if (!Array.isArray(cells) || cellId === undefined) return ''
    const source: unknown = cells.find(c => c?.id === cellId)?.source
    return Array.isArray(source) ? source.join('') : typeof source === 'string' ? source : ''
  } catch {
    return ''
  }
}
