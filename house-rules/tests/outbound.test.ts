import { test, expect } from 'claude-code/testing'

const EM = '\u2014'

// The tool beneath the plugin; `seen` is what arrived downstream.
const world = (on: any) => {
  const seen: any[] = []
  on('tool.call', ($: any, e: any) => {
    seen.push(e)
    return { result: {}, text: 'ok' }
  })
  return seen
}

test('Gmail draft subject and body arrive with a spaced hyphen', async ($, on) => {
  const seen = world(on)
  await $.tool.call({
    tool: 'mcp__claude_ai_Gmail__create_draft',
    subject: `Quick one ${EM} Thursday?`,
    body: `Quick one ${EM} are you free Thursday?`,
    to: ['a@example.com'],
    isHtml: false,
    count: 3,
  })
  const e = seen[0]
  expect(e.subject).toBe('Quick one - Thursday?')
  expect(e.body).toBe('Quick one - are you free Thursday?')
  expect(e.to).toEqual(['a@example.com'])
  expect(e.isHtml).toBe(false)
  expect(e.count).toBe(3)
})

test('Slack message arrives with a spaced hyphen', async ($, on) => {
  const seen = world(on)
  await $.tool.call({
    tool: 'mcp__claude_ai_Slack__slack_send_message',
    channel_id: 'C1',
    message: `Shipped${EM}finally`,
  })
  expect(seen[0].message).toBe('Shipped - finally')
  expect(seen[0].channel_id).toBe('C1')
})

test('GitHub issue body arrives with a spaced hyphen, nested fields too', async ($, on) => {
  const seen = world(on)
  await $.tool.call({
    tool: 'mcp__github__issue_write',
    method: 'create',
    title: `Bug ${EM} login`,
    body: `It breaks ${EM} badly`,
    labels: [`a ${EM} b`],
    meta: { note: `x${EM}y`, n: 1, ok: true },
  })
  const e = seen[0]
  expect(e.title).toBe('Bug - login')
  expect(e.body).toBe('It breaks - badly')
  expect(e.labels).toEqual(['a - b'])
  expect(e.meta).toEqual({ note: 'x - y', n: 1, ok: true })
})

test('a tool not on the list passes through untouched', async ($, on) => {
  const seen = world(on)
  await $.tool.call({
    tool: 'mcp__claude_ai_Gmail__search_threads',
    query: `a ${EM} b`,
  })
  expect(seen[0].query).toBe(`a ${EM} b`)
})

test('a built-in tool is untouched by the outbound swap', async ($, on) => {
  const seen = world(on)
  await $.tool.call({ tool: 'Bash', command: `echo "a ${EM} b"` })
  expect(seen[0].command).toBe(`echo "a ${EM} b"`)
})

test('custom outboundTools replaces the list', { options: { outboundTools: ['mcp__*__custom_send'] } }, async ($, on) => {
  const seen = world(on)
  await $.tool.call({ tool: 'mcp__acme__custom_send', text: `a ${EM} b` })
  await $.tool.call({ tool: 'mcp__claude_ai_Gmail__create_draft', body: `a ${EM} b` })
  expect(seen[0].text).toBe('a - b')
  expect(seen[1].body).toBe(`a ${EM} b`)
})
