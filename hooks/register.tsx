import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { SendStatus } from '../types'

const PANE = 'discord-draft'
const MAX_LEN = 2000 // Discord's limit for one message
const WEBHOOK = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/

const draft = atom({ plugin: 'discord-draft', key: 'draft' } as const, '', { shape: 'draft-1' })
const status = atom(
  { plugin: 'discord-draft', key: 'status' } as const,
  { kind: 'idle', text: '' } as SendStatus,
  { shape: 'status-1' },
)

const clock = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

export const register: Register = (on, options) => {
  const url = String(options.webhook_url ?? '').trim()
  const label = String(options.channel_label ?? '#talk')
  const sender = String(options.sender_name ?? 'Sent via Claude')

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'discord', description: `Open the Discord draft pane (${label})` })
    await $.tool.register({
      name: 'draft_discord',
      description:
        'Put a draft Discord message into the pane beside the chat for the person to read, edit and send. ' +
        'It never sends: only the person pressing Send in the pane posts it. Plain text, at most 2000 characters. ' +
        'Write it in the language the person asks for; keep it short and link to GitHub for detail.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', description: 'The message text' } },
        required: ['text'],
      },
      isDeferred: false,
    })
    return next(e)
  })

  on('command.run', { command: 'discord' }, async $ => {
    // A pane the engine still counts as open (closed from the window, or left from before a reload)
    // only gets retitled by open(), so close it first and open it fresh, with the keyboard.
    if ((await $.ui.panes()).some(pane => pane.id === PANE)) await $.ui.close({ id: PANE })
    const opened = await $.ui.open({ id: PANE, title: `Discord · ${label}`, focus: true })
    return {
      text: opened.isPlaced
        ? 'Discord draft pane opened.'
        : `Discord pane could not be shown: ${'reason' in opened ? opened.reason : 'unknown reason'}.`,
    }
  })

  on('tool.run', { tool: 'mcp__discord-draft__draft_discord' }, async ($, e) => {
    const text = String((e as unknown as { text?: unknown }).text ?? '')
    if (!text.trim()) return { result: 'Nothing drafted: the text was empty.', isError: true }
    if (text.length > MAX_LEN) return { result: `Too long for Discord (${text.length} > ${MAX_LEN} characters). Shorten it.`, isError: true }
    await update($, draft, () => text)
    await update($, status, () => ({ kind: 'idle', text: '' }) as SendStatus)
    const opened = await $.ui.open({ id: PANE, title: `Discord · ${label}` })
    // An open the person did not ask for is only drawn on a wide window; the toast tells them either way.
    $.ui.toast('Discord draft ready: type /discord if the pane is not showing.')
    return {
      result:
        `Draft placed in the Discord pane${opened.isPlaced ? '' : ` (not drawn: ${'reason' in opened ? opened.reason : 'window too narrow'}; the person can type /discord)`}. ` +
        'Not sent: the person reads it and presses Send. Tell the person to type /discord if they do not see the pane.',
    }
  }).catch(() => ({ result: 'The Discord draft pane failed; nothing was drafted or sent.', isError: true }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const text = await read($, draft)
    const st = await read($, status)

    const saveUrl = async (value: string) => {
      const v = value.trim()
      if (!WEBHOOK.test(v)) return update($, status, () => ({ kind: 'error', text: 'That is not a Discord webhook URL. Copy it from Edit Channel → Integrations → Webhooks.' }) as SendStatus)
      try {
        // A mod loaded from a folder may carry a suffix on its key (discord-draft@inline.webhook_url).
        const rows = await $.config.list()
        const row = rows.find(one => /^discord-draft(@[\w-]+)?\.webhook_url$/.test(one.key))
        if (!row) return update($, status, () => ({ kind: 'error', text: `Could not save it: no setting row for this mod (${rows.filter(one => one.key.startsWith('discord-draft')).map(one => one.key).join(', ') || 'none'}). Nothing was sent.` }) as SendStatus)
        const r = await $.config.set({ key: row.key, value: v })
        if ('deny' in r && r.deny) return update($, status, () => ({ kind: 'error', text: `Could not save it (${r.deny}). Nothing was sent.` }) as SendStatus)
        return update($, status, () => ({ kind: 'sent', text: 'Webhook saved. Press Send again.' }) as SendStatus)
      } catch (err) {
        return update($, status, () => ({ kind: 'error', text: `Could not save it (${String(err).slice(0, 120)}). Nothing was sent.` }) as SendStatus)
      }
    }

    const send = async () => {
      const body = (await read($, draft)).trim()
      if (!url) return update($, status, () => ({ kind: 'error', text: 'Set the webhook URL first: paste it in the box above.' }) as SendStatus)
      if (!WEBHOOK.test(url)) return update($, status, () => ({ kind: 'error', text: 'The webhook URL does not look like a Discord webhook.' }) as SendStatus)
      if (!body) return update($, status, () => ({ kind: 'error', text: 'Nothing to send.' }) as SendStatus)
      if (body.length > MAX_LEN) return update($, status, () => ({ kind: 'error', text: `Too long: ${body.length} of ${MAX_LEN} characters.` }) as SendStatus)
      await update($, status, () => ({ kind: 'sending', text: 'Sending…' }) as SendStatus)
      try {
        const res = await $.http.fetch(`${url}?wait=true`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // allowed_mentions: no @everyone, @here, role or user pings from a draft
          body: JSON.stringify({ content: body, username: sender, allowed_mentions: { parse: [] } }),
        })
        if (res.ok) {
          await update($, status, () => ({ kind: 'sent', text: `Sent to ${label} at ${clock(new Date())}` }) as SendStatus)
          await update($, draft, () => '')
        } else {
          await update($, status, () => ({ kind: 'error', text: `Discord answered ${res.status}. Nothing was posted.` }) as SendStatus)
        }
      } catch {
        await update($, status, () => ({ kind: 'error', text: 'Could not reach Discord. Nothing was posted.' }) as SendStatus)
      }
    }

    return (
      <Box flexDirection="column" gap={1}>
        {url ? (
          <Text dimColor>{`To ${label} as "${sender}"`}</Text>
        ) : (
          <Box flexDirection="column" gap={1}>
            <Text>No webhook yet. Paste the channel's webhook URL and press Enter (kept in ~/.claude/settings.json on this computer, never in the repo).</Text>
            <Input key="webhook" placeholder="https://discord.com/api/webhooks/…" submitLabel="save" onSubmit={saveUrl} />
          </Box>
        )}
        <Input
          key="draft"
          rows={6}
          value={text}
          placeholder="Claude puts a draft here. Edit it, then press Send."
          submitLabel="save"
          onInput={value => void update($, draft, () => value)}
          onSubmit={value => void update($, draft, () => value)}
        />
        <Text dimColor>{text.length} / {MAX_LEN}</Text>
        <Box flexDirection="row" gap={1}>
          <Button key="send" onPress={send}>Send</Button>
          <Button
            key="clear"
            onPress={async () => {
              await update($, draft, () => '')
              await update($, status, () => ({ kind: 'idle', text: '' }) as SendStatus)
            }}
          >
            Clear
          </Button>
        </Box>
        {st.text !== '' && (
          <Text color={st.kind === 'error' ? 'red' : st.kind === 'sent' ? 'green' : undefined}>{st.text}</Text>
        )}
      </Box>
    )
  })
}
