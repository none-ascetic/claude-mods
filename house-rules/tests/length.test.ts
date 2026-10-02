import { test, expect } from 'claude-code/testing'

const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ')

// The engine beneath the plugin: it ends turns with the answer as text and
// composes a system prompt of no sections, so any section in the result is
// one the mod added.
const world = (on: any) => {
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  on('prompt.compose', () => ({ sections: [] }))
}

const finish = ($: any, answer: string, turnId = 't1') =>
  $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId, reason: 'answer' })

// What Claude reads before its next reply, besides the engine's own prompt.
const nudges = async ($: any): Promise<string[]> => {
  const { sections } = await $.prompt.compose({
    model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [],
  })
  return sections.map((s: any) => s.text)
}

test('a 520-word reply queues exactly one nudge naming 520', async ($, on) => {
  world(on)
  await finish($, words(520))
  const found = await nudges($)
  expect(found.length).toBe(1)
  expect(found[0]).toContain('520')
  expect(found[0]).toMatch(/short/i)
  expect(found[0]).toMatch(/bullets/i)
})

test('the nudge is one-off: it is not repeated on the request after', async ($, on) => {
  world(on)
  await finish($, words(520))
  expect((await nudges($)).length).toBe(1)
  expect((await nudges($)).length).toBe(0)
})

test('the next reply under the threshold queues none', async ($, on) => {
  world(on)
  await finish($, words(520), 't1')
  expect((await nudges($)).length).toBe(1)
  await finish($, words(100), 't2')
  expect((await nudges($)).length).toBe(0)
})

test('a reply that is mostly a code block does not trigger it', async ($, on) => {
  world(on)
  await finish($, `Here you go:\n\`\`\`\n${words(600)}\n\`\`\`\nDone.`)
  expect((await nudges($)).length).toBe(0)
})

test('a reply that is mostly a table does not trigger it', async ($, on) => {
  world(on)
  const table = Array.from({ length: 80 }, () => `| ${words(4)} | ${words(4)} |`).join('\n')
  await finish($, `Summary.\n\n${table}\n`)
  expect((await nudges($)).length).toBe(0)
})

test('nothing is shown and nothing is blocked', async ($, on) => {
  world(on)
  const long = words(520)
  const r: any = await finish($, long)
  expect(r.text).toBe(long)
  expect(r.deny).toBeUndefined()
})

test('custom lengthThreshold is respected', { options: { lengthThreshold: 50 } }, async ($, on) => {
  world(on)
  await finish($, words(60))
  const found = await nudges($)
  expect(found.length).toBe(1)
  expect(found[0]).toContain('60')
  expect(found[0]).toContain('50')
})

test('a reply at exactly the threshold does not trigger', async ($, on) => {
  world(on)
  await finish($, words(300))
  expect((await nudges($)).length).toBe(0)
})

test('subagent turns are not nudged', async ($, on) => {
  world(on)
  await $.turn.complete({
    answer: words(520), durationMs: 1, isAborted: false, turnId: 't9', agentId: 'sub1', reason: 'answer',
  })
  expect((await nudges($)).length).toBe(0)
})

test('a four-backtick fence holding a three-backtick line is still code', async ($, on) => {
  world(on)
  await finish($, `\`\`\`\`\n\`\`\`\n${words(600)}\n\`\`\`\`\nDone.`)
  expect((await nudges($)).length).toBe(0)
})
