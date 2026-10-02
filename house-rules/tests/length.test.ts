import { test, expect } from 'claude-code/testing'

const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ')

// The session's rows beneath the plugin; `rows` is what got appended.
const world = (on: any) => {
  const rows: any[] = []
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  on('session.append', ($: any, e: any) => {
    rows.push(e)
    return { message: e.message, uuid: `u${rows.length}` }
  })
  return rows
}

const finish = ($: any, answer: string, turnId = 't1') =>
  $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId, reason: 'answer' })

const textOf = (row: any) => row.message.content.map((b: any) => b.text ?? '').join('')

test('a 520-word reply queues exactly one nudge naming 520', async ($, on) => {
  const rows = world(on)
  await finish($, words(520))
  expect(rows.length).toBe(1)
  expect(rows[0].message.type).toBe('user')
  expect(textOf(rows[0])).toContain('520')
  expect(textOf(rows[0])).toMatch(/short|bullets/i)
})

test('the next reply under the threshold queues none', async ($, on) => {
  const rows = world(on)
  await finish($, words(520), 't1')
  await finish($, words(100), 't2')
  expect(rows.length).toBe(1)
})

test('a reply that is mostly a code block does not trigger it', async ($, on) => {
  const rows = world(on)
  await finish($, `Here you go:\n\`\`\`\n${words(600)}\n\`\`\`\nDone.`)
  expect(rows.length).toBe(0)
})

test('a reply that is mostly a table does not trigger it', async ($, on) => {
  const rows = world(on)
  const table = Array.from({ length: 80 }, () => `| ${words(4)} | ${words(4)} |`).join('\n')
  await finish($, `Summary.\n\n${table}\n`)
  expect(rows.length).toBe(0)
})

test('nothing is shown and nothing is blocked', async ($, on) => {
  world(on)
  const long = words(520)
  const r: any = await finish($, long)
  expect(r.text).toBe(long)
  expect(r.deny).toBeUndefined()
})

test('custom lengthThreshold is respected', { options: { lengthThreshold: 50 } }, async ($, on) => {
  const rows = world(on)
  await finish($, words(60))
  expect(rows.length).toBe(1)
  expect(textOf(rows[0])).toContain('60')
})

test('a reply at exactly the threshold does not trigger', async ($, on) => {
  const rows = world(on)
  await finish($, words(300))
  expect(rows.length).toBe(0)
})

test('subagent turns are not nudged', async ($, on) => {
  const rows = world(on)
  await $.turn.complete({
    answer: words(520), durationMs: 1, isAborted: false, turnId: 't9', agentId: 'sub1', reason: 'answer',
  })
  expect(rows.length).toBe(0)
})
