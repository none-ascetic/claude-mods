import { test, expect } from 'claude-code/testing'

const EM = '—'
const EN = '–'
const STEP = { turnId: 't1', index: 0, model: 'm', messageCount: 1 }

// Streams the given pieces as one text block, as the model would, and
// returns the text that comes out of the plugin (what Paddy sees).
const shown = async ($: any, on: any, pieces: string[]) => {
  on('turn.step', async function* () {
    for (const text of pieces) yield { kind: 'text', index: 0, text }
    yield { kind: 'stop', stopReason: 'end_turn', usage: null }
    return { turnId: 't1', index: 0, answer: pieces.join(''), toolUses: [], stopReason: 'end_turn', usage: null }
  })
  let out = ''
  for await (const chunk of $.turn.step(STEP) as AsyncIterable<any>) {
    if (chunk.kind === 'text') out += chunk.text
  }
  return out
}

test('em dash with spaces becomes a spaced hyphen', async ($, on) => {
  expect(await shown($, on, [`simple ${EM} drop it`])).toBe('simple - drop it')
})

test('em dash with no spaces becomes a spaced hyphen', async ($, on) => {
  expect(await shown($, on, [`simple${EM}drop it`])).toBe('simple - drop it')
})

test('spaced en dash becomes a spaced hyphen', async ($, on) => {
  expect(await shown($, on, [`simple ${EN} drop it`])).toBe('simple - drop it')
})

test('lots of whitespace around the dash collapses to one space each side', async ($, on) => {
  expect(await shown($, on, [`simple   ${EM}\t  drop it`])).toBe('simple - drop it')
})

test('unspaced en dash in a range is left alone', async ($, on) => {
  expect(await shown($, on, [`It takes 2${EN}3 days`])).toBe(`It takes 2${EN}3 days`)
})

test('em dash inside a fenced code block is left alone', async ($, on) => {
  const text = `Before ${EM} after\n\`\`\`\ncode ${EM} here\n\`\`\`\nAfter ${EM} fence`
  expect(await shown($, on, [text])).toBe(
    `Before - after\n\`\`\`\ncode ${EM} here\n\`\`\`\nAfter - fence`,
  )
})

test('em dash split into its own chunk, spaces either side, is swapped', async ($, on) => {
  expect(await shown($, on, ['simple ', EM, ' drop it'])).toBe('simple - drop it')
})

test('em dash split into its own chunk, no spaces, is swapped', async ($, on) => {
  expect(await shown($, on, ['simple', EM, 'drop it'])).toBe('simple - drop it')
})

test('spaced en dash split across chunks is swapped', async ($, on) => {
  expect(await shown($, on, ['simple ', EN, ' drop it'])).toBe('simple - drop it')
})

test('a fence split across chunks still protects its contents', async ($, on) => {
  const out = await shown($, on, ['text\n``', '`\ncode ', EM, ' x\n``', '`\nok ', EM, ' done'])
  expect(out).toBe(`text\n\`\`\`\ncode ${EM} x\n\`\`\`\nok - done`)
})

test('text with no dashes streams through unchanged, trailing space kept', async ($, on) => {
  expect(await shown($, on, ['hello ', 'there ', 'friend '])).toBe('hello there friend ')
})
