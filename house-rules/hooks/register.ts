import type { Register } from 'claude-code'
import {
  DEFAULT_OUTBOUND_TOOLS,
  DashSwapper,
  addedDashes,
  exemptMatcher,
  mayHaveDash,
  notebookCellSource,
  outboundMatcher,
  proseWords,
  repunctuateMessage,
  swapDashes,
  swapDeep,
} from './rules'

const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s !== '') : []

export const register: Register = (on, options) => {
  const threshold =
    typeof options.lengthThreshold === 'number' && options.lengthThreshold > 0
      ? options.lengthThreshold
      : 300
  const isExempt = exemptMatcher(list(options.exemptPaths))
  const outbound = list(options.outboundTools)
  const outboundTools = outboundMatcher(outbound.length > 0 ? outbound : DEFAULT_OUTBOUND_TOOLS)

  // Chat: swap dashes in the reply as it streams, so Paddy never sees one.
  on('turn.step', async function* ($, e, next) {
    const swappers = new Map<number, DashSwapper>()
    const flushHeld = function* () {
      for (const [index, swapper] of swappers) {
        const text = swapper.flush()
        if (text !== '') yield { kind: 'text' as const, index, text }
      }
    }
    const stream = next(e)[Symbol.asyncIterator]()
    for (;;) {
      const step = await stream.next()
      if (step.done) {
        yield* flushHeld()
        const result = step.value
        return result && { ...result, answer: swapDashes(result.answer, true) }
      }
      const chunk = step.value
      if (chunk.kind !== 'text') {
        yield* flushHeld()
        yield chunk
        continue
      }
      let swapper = swappers.get(chunk.index)
      if (!swapper) swappers.set(chunk.index, (swapper = new DashSwapper(true)))
      const text = swapper.push(chunk.text)
      if (text !== '') yield { ...chunk, text }
    }
  })

  // Files: block writes that add em dashes; Claude repunctuates.
  const guard = (path: string, oldText: string, newText: string, firstLine = 1) => {
    if (isExempt(path)) return undefined
    const { count, lines } = addedDashes(oldText, newText, firstLine)
    if (count === 0) return undefined
    return { deny: repunctuateMessage(count, lines) }
  }

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if (!mayHaveDash(e.content)) return next(e)
    const file = await $.fs.read(e.file_path).catch(() => '')
    return guard(e.file_path, file, e.content) ?? next(e)
  })
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    if (!mayHaveDash(e.new_string)) return next(e)
    const file = await $.fs.read(e.file_path).catch(() => '')
    const at = file.indexOf(e.old_string)
    const firstLine = at < 0 ? 1 : file.slice(0, at).split('\n').length
    return guard(e.file_path, e.old_string, e.new_string, firstLine) ?? next(e)
  })
  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    if (e.edit_mode === 'delete' || !mayHaveDash(e.new_source)) return next(e)
    const notebook = await $.fs.read(e.notebook_path).catch(() => '')
    const before = e.edit_mode === 'insert' ? '' : notebookCellSource(notebook, e.cell_id)
    return guard(e.notebook_path, before, e.new_source) ?? next(e)
  })

  // Outbound: swap dashes in every text field before the call goes out.
  const RESERVED = new Set(['tool', 'tool_use_id', 'agentId'])
  on('tool.call', { tool: outboundTools }, ($, e, next) => {
    const swapped: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(e)) swapped[k] = RESERVED.has(k) ? v : swapDeep(v)
    return next(swapped as typeof e)
  })

  // Length: a quiet note for Claude only; Paddy sees nothing, nothing blocks.
  // It rides the next system prompt as one extra section, once, then is gone.
  let pendingNote: string | null = null

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer') return result
    const words = proseWords(e.answer)
    pendingNote =
      words > threshold
        ? `House Rules: your last reply was ${words} words of prose. ` +
          `Paddy wants short replies: bullets, under ${threshold} words unless he asks for depth. ` +
          'He cannot see this note. Do not mention it.'
        : null
    return result
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const isRealRequest = !e.traits.some(t => t === 'analysis' || t === 'teammate')
    if (pendingNote === null || !isRealRequest) return composed
    const text = pendingNote
    pendingNote = null
    return {
      sections: [...composed.sections, { id: 'house-rules:length-nudge', text, scope: 'session' }],
    }
  })
}
