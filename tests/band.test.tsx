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

const BAND = {
  plugin: 'discord-draft',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 12,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
} as const

const HOOK = 'https://discord.com/api/webhooks/123/abc-DEF_1'

test('with no draft the band draws nothing of its own', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Discord/ })).toBeFalsy()
  await ui.unmount()
})

test('a draft shows in the band above the prompt, and Send there posts it', { options: { webhook_url: HOOK, channel_label: '#team' } }, async ($, on) => {
  const bodies: string[] = []
  on('http.fetch', (_, e) => {
    bodies.push(String(e.init?.body ?? ''))
    return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
  })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.input({ key: 'draft', text: 'PR 143 is approved.', kind: 'change' })
  await pane.unmount()

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ type: 'Text', text: /Discord · #team/ })).toBeTruthy()
    expect(await band.find({ type: 'Text', text: /19 \/ 2000/ })).toBeTruthy()
    await band.unmount()
  }

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'send' })
  expect(bodies.length).toBe(1)
  expect(JSON.parse(bodies[0] ?? '{}').content).toBe('PR 143 is approved.')
  expect(await band.find({ type: 'Text', text: /Sent to #team/ })).toBeTruthy()
  await band.unmount()
})

test('the band yields to a survey', async $ => {
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.input({ key: 'draft', text: 'hello', kind: 'change' })
  await pane.unmount()
  const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'desktop' })
  expect(await band.find({ type: 'Text', text: /Discord/ })).toBeFalsy()
  await band.unmount()
})
