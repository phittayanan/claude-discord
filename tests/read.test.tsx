import { expect, test } from 'claude-code/testing'

// A made-up token in the bot-token shape. Not a real token; no test reaches the network.
const TOKEN = 'MTAwMDAwMDAwMDAwMDAwMDAw.GabCdE.fake-token-for-tests-only_0123456789'
const CHANNEL = '1575536526782111934'
const TOOL = 'mcp__discord-draft__read_discord'

const PANE = {
  plugin: 'discord-draft',
  component: 'Pane',
  requestId: 'discord-draft',
  props: {
    title: 'Discord · #talk',
    isFocused: true,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  value: { status, ok: status >= 200 && status < 300, headers, text: JSON.stringify(body) },
})

const phut = { id: '111111111111111111', username: 'phut', global_name: 'Phut' }
const nan = { id: '222222222222222222', username: 'nan_dev', global_name: null }

const MESSAGES = [
  // Discord sends the newest first.
  {
    id: '1500000000000000003',
    type: 19,
    timestamp: '2026-11-28T07:10:00.000+00:00',
    content: 'ok <@111111111111111111>, merging after CI',
    author: nan,
    mentions: [phut],
    embeds: [{ title: 'PR 143: habit streaks', url: 'https://github.com/x/y/pull/143' }],
    attachments: [],
    referenced_message: { id: '1500000000000000002', author: phut },
  },
  {
    id: '1500000000000000002',
    type: 0,
    timestamp: '2026-11-28T07:05:00.000+00:00',
    content: 'line one\nline two',
    author: phut,
    attachments: [{ filename: 'screenshot.png', url: 'https://cdn.discordapp.com/a.png' }],
  },
]

const text = (r: unknown) => String((r as { text?: unknown; result?: unknown }).text ?? (r as { result?: unknown }).result ?? '')

test('with no token it reads nothing and says how to paste one', async ($, on) => {
  const urls: string[] = []
  on('http.fetch', (_, e) => {
    urls.push(e.url)
    return json(200, [])
  })
  const r = await $.tool.call({ tool: TOOL })
  expect(text(r)).toContain('No bot token')
  expect(text(r)).toContain('/discord')
  expect(urls.length).toBe(0)
})

test('it GETs the channel with the bot token and formats oldest first in +07:00', { options: { bot_token: TOKEN, channel_id: CHANNEL } }, async ($, on) => {
  const calls: { url: string; method?: string; auth?: string }[] = []
  on('http.fetch', (_, e) => {
    const headers = (e.init?.headers ?? {}) as Record<string, string>
    calls.push({ url: e.url, method: e.init?.method, auth: headers.authorization })
    return json(200, MESSAGES)
  })
  const r = await $.tool.call({ tool: TOOL, limit: 2, before: '1500000000000000009' })
  expect(calls.length).toBe(1)
  expect(calls[0]?.url).toBe(`https://discord.com/api/v10/channels/${CHANNEL}/messages?limit=2&before=1500000000000000009`)
  expect(calls[0]?.method).toBe('GET')
  expect(calls[0]?.auth).toBe(`Bot ${TOKEN}`)
  const out = text(r)
  expect(out).not.toContain(TOKEN)
  expect(out).toContain('[2026-11-28 14:05 +07:00] Phut (phut) · id 1500000000000000002')
  expect(out).toContain('  line one\n  line two')
  expect(out).toContain('  attachment: screenshot.png')
  expect(out).toContain('[2026-11-28 14:10 +07:00] nan_dev ↪ reply to Phut (phut)')
  expect(out).toContain('ok @Phut, merging after CI')
  expect(out).toContain('  embed: PR 143: habit streaks — https://github.com/x/y/pull/143')
  expect(out.indexOf('14:05')).toBeLessThan(out.indexOf('14:10'))
  expect(out).toContain('before=1500000000000000002')
})

test('limit defaults to 30 and is held to 1..100', { options: { bot_token: TOKEN } }, async ($, on) => {
  const urls: string[] = []
  on('http.fetch', (_, e) => {
    urls.push(e.url)
    return json(200, [])
  })
  expect(text(await $.tool.call({ tool: TOOL }))).toContain('No messages')
  expect(urls[0]).toBe(`https://discord.com/api/v10/channels/${CHANNEL}/messages?limit=30`)
  expect(text(await $.tool.call({ tool: TOOL, limit: 101 }))).toContain('1 to 100')
  expect(text(await $.tool.call({ tool: TOOL, before: 'abc' }))).toContain('message id')
  expect(urls.length).toBe(1)
})

for (const [status, words] of [
  [401, 'token is wrong'],
  [403, 'View Channel and Read Message History'],
  [404, 'no channel'],
  [500, 'answered 500'],
] as const) {
  test(`a ${status} says what to fix and never shows the token`, { options: { bot_token: TOKEN } }, async ($, on) => {
    on('http.fetch', () => json(status, { message: 'nope', code: 0 }))
    const out = text(await $.tool.call({ tool: TOOL }))
    expect(out).toContain(words)
    expect(out).not.toContain(TOKEN)
  })
}

test('a 429 reports retry_after', { options: { bot_token: TOKEN } }, async ($, on) => {
  on('http.fetch', () => json(429, { message: 'You are being rate limited.', retry_after: 2.5, global: false }, { 'retry-after': '3' }))
  expect(text(await $.tool.call({ tool: TOOL }))).toContain('Try again in 2.5 seconds')
})

test('a 429 with only the header reports it', { options: { bot_token: TOKEN } }, async ($, on) => {
  on('http.fetch', () => ({ value: { status: 429, ok: false, headers: { 'retry-after': '7' }, text: '' } }))
  expect(text(await $.tool.call({ tool: TOOL }))).toContain('Try again in 7 seconds')
})

test('all-empty content points at Message Content Intent', { options: { bot_token: TOKEN } }, async ($, on) => {
  on('http.fetch', () =>
    json(200, MESSAGES.map(m => ({ ...m, content: '', embeds: [], attachments: [] }))),
  )
  const out = text(await $.tool.call({ tool: TOOL }))
  expect(out).toContain('Message Content Intent')
  expect(out).toContain('nan_dev')
})

test('a message with only an attachment is not taken for a missing intent', { options: { bot_token: TOKEN } }, async ($, on) => {
  on('http.fetch', () => json(200, [{ ...MESSAGES[1], content: '' }]))
  const out = text(await $.tool.call({ tool: TOOL }))
  expect(out).not.toContain('Message Content Intent')
  expect(out).toContain('attachment: screenshot.png')
})

test('a network failure reads nothing', { options: { bot_token: TOKEN } }, async ($, on) => {
  on('http.fetch', () => {
    throw new Error('offline')
  })
  expect(text(await $.tool.call({ tool: TOOL }))).toContain('Could not reach Discord')
})

test('the pane asks for a token, refuses a non-token and never shows a saved one', { options: { bot_token: TOKEN } }, async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /bot token set \(hidden\)/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: new RegExp(TOKEN.slice(0, 12)) })).toBeFalsy()
    await ui.input({ key: 'token', text: 'hello' })
    expect(await ui.find({ type: 'Text', text: /does not look like a bot token/ })).toBeTruthy()
    await ui.unmount()
  }
})

test('with no token the pane shows where to paste it', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /No bot token yet/ })).toBeTruthy()
  await ui.unmount()
})

test('a pasted token is saved to the bot_token setting, "Bot " prefix dropped', async ($, on) => {
  const saved: { key: string; value: unknown }[] = []
  // The engine lists the mod's visible rows; bot_token is hidden, so it is not among them.
  const row = (field: string) => ({ key: `discord-draft@inline.${field}`, label: field, kind: 'text' as const, value: '', provider: { kind: 'plugin' as const, name: 'discord-draft' }, isLocked: false })
  on('config.list', () => ({ value: [row('webhook_url'), row('channel_label')] }))
  on('config.set', (_, e) => {
    saved.push({ key: e.key, value: e.value })
    return { value: e.value }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.input({ key: 'token', text: `Bot ${TOKEN}` })
  expect(saved.map(s => s.key)).toEqual(['discord-draft@inline.bot_token'])
  expect(saved[0]?.value).toBe(TOKEN)
  expect(await ui.find({ type: 'Text', text: /Bot token saved/ })).toBeTruthy()
  await ui.unmount()
})
