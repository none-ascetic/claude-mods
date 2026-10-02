import { test, expect } from 'claude-code/testing'

const EM = '—'

// The file system and the tool beneath the plugin: `existing` is what the
// file holds now (undefined: it does not exist); `ran` collects the calls
// that got through to the tool.
const denial = (r: any): string | undefined => r.deny ?? (r.isError ? r.text : undefined)

const world = (on: any, existing: string | undefined) => {
  const ran: any[] = []
  on('fs.read', () => {
    if (existing === undefined) throw new Error('ENOENT')
    return { value: existing }
  })
  on('tool.call', ($: any, e: any) => {
    ran.push(e)
    return { result: {}, text: 'ok' }
  })
  return ran
}

test('Write of new content with an em dash is blocked, naming the line', async ($, on) => {
  const ran = world(on, undefined)
  const r: any = await $.tool.call({
    tool: 'Write',
    file_path: '/repo/README.md',
    content: `# Title\n\nFast ${EM} and cheap\n`,
  })
  expect(denial(r)).toBeDefined()
  expect(denial(r)).toContain('1 em dash')
  expect(denial(r)).toContain('line 3')
  expect(denial(r)).toContain(`Fast ${EM} and cheap`)
  expect(denial(r)).toMatch(/repunctuate/i)
  expect(ran.length).toBe(0)
})

test('Write of clean content goes through', async ($, on) => {
  const ran = world(on, undefined)
  await $.tool.call({ tool: 'Write', file_path: '/repo/README.md', content: 'Fast and cheap.\n' })
  expect(ran.length).toBe(1)
})

test('Write over a file that already has dashes, adding none, goes through', async ($, on) => {
  const ran = world(on, `old ${EM} line\n`)
  await $.tool.call({
    tool: 'Write',
    file_path: '/repo/a.md',
    content: `old ${EM} line\nnew line\n`,
  })
  expect(ran.length).toBe(1)
})

test('Write that adds a second dash to a file that already has one is blocked', async ($, on) => {
  const ran = world(on, `old ${EM} line\n`)
  const r: any = await $.tool.call({
    tool: 'Write',
    file_path: '/repo/a.md',
    content: `old ${EM} line\nnew ${EM} line\n`,
  })
  expect(denial(r)).toBeDefined()
  expect(denial(r)).toContain('line 2')
  expect(denial(r)).not.toContain('line 1')
  expect(ran.length).toBe(0)
})

test('Edit that adds an em dash is blocked', async ($, on) => {
  const ran = world(on, 'Fast and cheap\n')
  const r: any = await $.tool.call({
    tool: 'Edit',
    file_path: '/repo/a.md',
    old_string: 'Fast and cheap',
    new_string: `Fast ${EM} and cheap`,
  })
  expect(denial(r)).toBeDefined()
  expect(denial(r)).toMatch(/repunctuate/i)
  expect(ran.length).toBe(0)
})

test('Edit to a file that already has em dashes, adding none, goes through', async ($, on) => {
  const ran = world(on, `keep ${EM} this\nchange me\n`)
  await $.tool.call({
    tool: 'Edit',
    file_path: '/repo/a.md',
    old_string: 'change me',
    new_string: 'changed',
  })
  expect(ran.length).toBe(1)
})

test('Edit that keeps an existing dash in the replaced text adds none', async ($, on) => {
  const ran = world(on, `keep ${EM} this\n`)
  await $.tool.call({
    tool: 'Edit',
    file_path: '/repo/a.md',
    old_string: `keep ${EM} this`,
    new_string: `keep ${EM} this, mostly`,
  })
  expect(ran.length).toBe(1)
})

test('a spaced en dash counts, an unspaced one does not', async ($, on) => {
  const ran = world(on, undefined)
  const blocked: any = await $.tool.call({
    tool: 'Write',
    file_path: '/repo/a.md',
    content: 'one – two\n',
  })
  expect(denial(blocked)).toBeDefined()
  await $.tool.call({ tool: 'Write', file_path: '/repo/b.md', content: '2–3 days\n' })
  expect(ran.length).toBe(1)
})

test('NotebookEdit that adds an em dash is blocked', async ($, on) => {
  const ran = world(on, undefined)
  const r: any = await $.tool.call({
    tool: 'NotebookEdit',
    notebook_path: '/repo/n.ipynb',
    new_source: `# Notes ${EM} draft`,
  })
  expect(denial(r)).toBeDefined()
  expect(ran.length).toBe(0)
})

test('an exempt path is allowed, others still blocked', { options: { exemptPaths: ['docs/quotes/*.md'] } }, async ($, on) => {
  const ran = world(on, undefined)
  await $.tool.call({
    tool: 'Write',
    file_path: '/repo/docs/quotes/one.md',
    content: `quote ${EM} source\n`,
  })
  expect(ran.length).toBe(1)
  const r: any = await $.tool.call({
    tool: 'Write',
    file_path: '/repo/docs/other.md',
    content: `quote ${EM} source\n`,
  })
  expect(denial(r)).toBeDefined()
})
