import { expect, test } from 'claude-code/testing'

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

const HOOK = 'https://discord.com/api/webhooks/123/abc-DEF_1'

test('Send without a webhook posts nothing and says what to set', async ($, on) => {
  const posts: string[] = []
  on('http.fetch', (_, e) => {
    posts.push(e.url)
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.input({ key: 'draft', text: 'Hi phut', kind: 'change' })
    await ui.press({ key: 'send' })
    expect((await ui.find({ type: 'Text', text: /Set the webhook URL/ }))?.text).toContain('paste it')
    await ui.unmount()
  }
  expect(posts.length).toBe(0)
})

test('Send posts the edited text once, with no pings, and clears the box', { options: { webhook_url: HOOK } }, async ($, on) => {
  const bodies: string[] = []
  on('http.fetch', (_, e) => {
    bodies.push(String(e.init?.body ?? ''))
    return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.input({ key: 'draft', text: 'Hi phut, PR 143 has one more point.', kind: 'change' })
  expect(bodies.length).toBe(0) // typing alone sends nothing
  await ui.press({ key: 'send' })
  expect(bodies.length).toBe(1)
  const sent = JSON.parse(bodies[0] ?? '{}')
  expect(sent.content).toBe('Hi phut, PR 143 has one more point.')
  expect(sent.allowed_mentions).toEqual({ parse: [] })
  expect((await ui.find({ type: 'Text', text: /Sent to #talk/ }))).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /^0 \/ 2000$/ }))).toBeTruthy()
  await ui.unmount()
})

test('a Discord error is shown and the draft is kept', { options: { webhook_url: HOOK } }, async ($, on) => {
  on('http.fetch', () => ({ value: { status: 404, ok: false, headers: {}, text: '' } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.input({ key: 'draft', text: 'keep me', kind: 'change' })
  await ui.press({ key: 'send' })
  expect((await ui.find({ type: 'Text', text: /answered 404/ }))?.text).toContain('Nothing was posted')
  expect((await ui.find({ type: 'Text', text: /7 \/ 2000/ }))).toBeTruthy()
  await ui.unmount()
})
