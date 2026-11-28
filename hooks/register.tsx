import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SendStatus } from '../types'

const PANE = 'discord-draft'
const MAX_LEN = 2000 // Discord's limit for one message
const WEBHOOK = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/
const API = 'https://discord.com/api/v10'
const SNOWFLAKE = /^\d{15,25}$/
// A bot token is three base64url parts joined by dots. A user-account token is never used.
const BOT_TOKEN = /^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/
const DEFAULT_CHANNEL = '1575536526782111934' // the team's #talk
const OWN_KEY = /^discord-draft(@[\w-]+)?\.\w+$/

const draft = atom({ plugin: 'discord-draft', key: 'draft' } as const, '', { shape: 'draft-1' })
const status = atom(
  { plugin: 'discord-draft', key: 'status' } as const,
  { kind: 'idle', text: '' } as SendStatus,
  { shape: 'status-1' },
)

const clock = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
const pad = (n: number) => String(n).padStart(2, '0')

/** An ISO timestamp as Bangkok time: 2026-11-28 14:05 +07:00. */
function localTime(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return iso
  const d = new Date(ms + 7 * 3600_000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} +07:00`
}

type User = { id: string; username: string; global_name?: string | null }
type Message = {
  id: string
  type?: number
  timestamp: string
  content?: string
  author: User
  mentions?: User[]
  embeds?: { title?: string; url?: string; description?: string }[]
  attachments?: { filename: string; url?: string }[]
  referenced_message?: { id: string; author?: User } | null
}

const who = (u: User) => (u.global_name && u.global_name !== u.username ? `${u.global_name} (${u.username})` : u.username)

/** Discord answers newest first; this lists them oldest first, one block each. */
function formatMessages(messages: Message[], label: string): string {
  if (messages.length === 0) return `No messages in ${label} here.`
  const lines: string[] = []
  for (const m of [...messages].reverse()) {
    const names = new Map((m.mentions ?? []).map(u => [u.id, u.global_name || u.username]))
    const content = (m.content ?? '').replace(/<@!?(\d+)>/g, (all, id: string) => (names.has(id) ? `@${names.get(id)}` : all))
    const reply = m.referenced_message ? ` ↪ reply to ${m.referenced_message.author ? who(m.referenced_message.author) : 'a message'}` : ''
    lines.push(`[${localTime(m.timestamp)}] ${who(m.author)}${reply} · id ${m.id}`)
    if (content) lines.push(...content.split('\n').map(line => `  ${line}`))
    for (const e of m.embeds ?? []) {
      const title = e.title || e.description?.slice(0, 80)
      if (title || e.url) lines.push(`  embed: ${[title, e.url].filter(Boolean).join(' — ')}`)
    }
    for (const a of m.attachments ?? []) lines.push(`  attachment: ${a.filename}`)
  }
  const oldest = messages[messages.length - 1]
  lines.push('', `${messages.length} messages, oldest first. For older ones call read_discord with before=${oldest?.id}.`)
  return lines.join('\n')
}

// Messages people write (default and reply) are blank only when the bot cannot see content.
const contentHidden = (messages: Message[]) => {
  const written = messages.filter(m => m.type === undefined || m.type === 0 || m.type === 19)
  return written.length > 0 && written.every(m => !m.content && !(m.embeds ?? []).length && !(m.attachments ?? []).length)
}

type ReadInput = { limit?: unknown; before?: unknown }
type ReadAnswer = { result: string; isError?: true }

/** Read-only: one GET of a channel's messages. The token goes in the header and nowhere else. */
async function readChannel($: EngineInterface, opts: { token: string; channel: string; label: string }, input: ReadInput): Promise<ReadAnswer> {
  const fail = (result: string): ReadAnswer => ({ result, isError: true })
  if (!opts.token) return fail('No bot token is set. Ask the person to type /discord and paste the bot token into the pane (never into the chat). Setup steps are in the README under "Reading".')
  if (!BOT_TOKEN.test(opts.token)) return fail('The saved bot token does not look like a Discord bot token. Ask the person to reset it in the Developer Portal (Bot → Reset Token) and paste it again in /discord.')
  if (!SNOWFLAKE.test(opts.channel)) return fail(`channel_id "${opts.channel}" is not a Discord channel id. Set it in the plugin settings.`)
  const raw = input.limit === undefined ? 30 : Number(input.limit)
  if (!Number.isInteger(raw) || raw < 1 || raw > 100) return fail('limit must be a whole number from 1 to 100.')
  const before = input.before === undefined || input.before === '' ? '' : String(input.before)
  if (before && !SNOWFLAKE.test(before)) return fail('before must be a Discord message id (digits only).')

  const url = `${API}/channels/${opts.channel}/messages?limit=${raw}${before ? `&before=${before}` : ''}`
  let res
  try {
    res = await $.http.fetch(url, {
      method: 'GET',
      headers: { authorization: `Bot ${opts.token}`, 'user-agent': 'DiscordBot (https://github.com/phittayanan/claude-discord, 0.3.0)' },
    })
  } catch {
    return fail('Could not reach Discord.')
  }
  if (res.status === 401) return fail('Discord answered 401: the bot token is wrong or was reset. Ask the person to reset it (Developer Portal → Bot → Reset Token) and paste the new one in /discord.')
  if (res.status === 403) return fail(`Discord answered 403: the bot cannot read ${opts.label}. It needs View Channel and Read Message History there (server settings or the channel's permissions), and it must be in the server.`)
  if (res.status === 404) return fail(`Discord answered 404: no channel ${opts.channel} that the bot can see. Check channel_id and that the bot was added to the server.`)
  if (res.status === 429) {
    let wait = res.headers['retry-after'] ?? ''
    try {
      const body = JSON.parse(res.text) as { retry_after?: number }
      if (typeof body.retry_after === 'number') wait = String(body.retry_after)
    } catch {}
    return fail(`Discord answered 429 (rate limited). Try again in ${wait || 'a few'} seconds.`)
  }
  if (!res.ok) return fail(`Discord answered ${res.status}. Nothing was read.`)
  let messages: Message[]
  try {
    messages = JSON.parse(res.text) as Message[]
    if (!Array.isArray(messages)) throw new Error('not a list')
  } catch {
    return fail('Discord sent something that is not a list of messages.')
  }
  if (contentHidden(messages))
    return fail(
      `Every message came back with empty content: Message Content Intent is off for the bot. ` +
        `Ask the person to turn it on: Developer Portal → the application → Bot → Privileged Gateway Intents → Message Content Intent, then Save. ` +
        `Authors and times only:\n${formatMessages(messages, opts.label)}`,
    )
  return { result: `${opts.label}:\n${formatMessages(messages, opts.label)}` }
}

// Save the webhook, send the draft and clear it: the same for the pane and the band.
type Channel = { url: string; label: string; sender: string }

// Save one of this mod's settings to ~/.claude/settings.json. The bot_token row is hidden from
// /config (and so from $.config.list), so its key is built from the prefix of a row that is listed:
// a mod loaded from a folder may carry a suffix on its key (discord-draft@inline.webhook_url).
async function saveSetting($: EngineInterface, field: string, value: string, done: string) {
  const say = (kind: SendStatus['kind'], text: string) => update($, status, () => ({ kind, text }) as SendStatus)
  try {
    const rows = await $.config.list()
    const row = rows.find(one => OWN_KEY.test(one.key))
    if (!row) return say('error', 'Could not save it: no setting row for this mod.')
    const r = await $.config.set({ key: row.key.replace(/\.\w+$/, `.${field}`), value })
    if ('deny' in r && r.deny) return say('error', `Could not save it (${r.deny}).`)
    return say('sent', done)
  } catch {
    // The error could quote the value; say only that it failed.
    return say('error', 'Could not save it.')
  }
}

const saveToken = ($: EngineInterface) => async (value: string) => {
  const v = value.trim().replace(/^Bot\s+/i, '')
  if (!BOT_TOKEN.test(v)) return update($, status, () => ({ kind: 'error', text: 'That does not look like a bot token. Copy it from Developer Portal → Bot → Reset Token.' }) as SendStatus)
  return saveSetting($, 'bot_token', v, 'Bot token saved. Claude can read the channel now.')
}

function actions($: EngineInterface, { url, label, sender }: Channel) {
  const saveUrl = async (value: string) => {
    const v = value.trim()
    if (!WEBHOOK.test(v)) return update($, status, () => ({ kind: 'error', text: 'That is not a Discord webhook URL. Copy it from Edit Channel → Integrations → Webhooks.' }) as SendStatus)
    return saveSetting($, 'webhook_url', v, 'Webhook saved. Press Send again.')
  }

  const send = async () => {
    const body = (await read($, draft)).trim()
    if (!url) return update($, status, () => ({ kind: 'error', text: 'Set the webhook URL first: type /discord and paste it in the box at the top.' }) as SendStatus)
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

  const clear = async () => {
    await update($, draft, () => '')
    await update($, status, () => ({ kind: 'idle', text: '' }) as SendStatus)
  }

  return { saveUrl, send, clear }
}

export const register: Register = (on, options) => {
  const url = String(options.webhook_url ?? '').trim()
  const label = String(options.channel_label ?? '#talk')
  const sender = String(options.sender_name ?? 'Sent via Claude')
  const token = String(options.bot_token ?? '').trim()
  const channel = String(options.channel_id ?? DEFAULT_CHANNEL).trim()

  // The bot token never shows in /config: the pane is where it is pasted.
  on('config.describe', async ($, e, next) => {
    const row = await next(e)
    return /\.bot_token$/.test(e.key) && OWN_KEY.test(e.key) ? { ...row, isHidden: true } : row
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'discord', description: `Open the Discord draft pane (${label})` })
    await $.tool.register({
      name: 'draft_discord',
      description:
        'Put a draft Discord message in the Discord band above the prompt for the person to read, edit and send. ' +
        'It never sends: only the person pressing Send posts it. Plain text, at most 2000 characters. ' +
        'Write it in the language the person asks for; keep it short and link to GitHub for detail.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', description: 'The message text' } },
        required: ['text'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'read_discord',
      description:
        `Read recent messages of the team's Discord channel (${label}) as text: author, time (+07:00), content, embeds and attachment names, oldest first. ` +
        'Read-only: it cannot send, edit, delete or react. Use it instead of screenshots of Discord. ' +
        'Page back with before=<the oldest id shown>.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, description: 'How many messages, newest first from Discord (default 30, max 100)' },
          before: { type: 'string', description: 'Only messages older than this message id, for paging' },
        },
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
    $.ui.toast('Discord draft ready above the prompt.')
    return {
      result:
        'Draft placed in the Discord band above the prompt (also in the /discord pane). ' +
        'Not sent: the person reads it and presses Send.',
    }
  }).catch(() => ({ result: 'The Discord draft pane failed; nothing was drafted or sent.', isError: true }))

  on('tool.run', { tool: 'mcp__discord-draft__read_discord' }, async ($, e) =>
    readChannel($, { token, channel, label }, e as unknown as ReadInput),
  ).catch(() => ({ result: 'read_discord failed; nothing was read.', isError: true }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const text = await read($, draft)
    const st = await read($, status)

    const { saveUrl, send, clear } = actions($, { url, label, sender })

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
        {token ? (
          <Box flexDirection="column">
            <Text dimColor>{`Reading: bot token set (hidden), channel ${channel}`}</Text>
            <Input key="token" placeholder="Paste a new bot token to replace it" submitLabel="save" onSubmit={saveToken($)} />
          </Box>
        ) : (
          <Box flexDirection="column">
            <Text>No bot token yet, so Claude cannot read the channel. Paste the bot token and press Enter (kept in ~/.claude/settings.json, never shown again).</Text>
            <Input key="token" placeholder="Bot token from Developer Portal → Bot → Reset Token" submitLabel="save" onSubmit={saveToken($)} />
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
          <Button key="clear" onPress={clear}>Clear</Button>
        </Box>
        {st.text !== '' && (
          <Text color={st.kind === 'error' ? 'red' : st.kind === 'sent' ? 'green' : undefined}>{st.text}</Text>
        )}
      </Box>
    )
  })

  // The band above the prompt: shown only while there is a draft or a send result to read.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const text = await read($, draft)
    const st = await read($, status)
    if (e.props.hasSurvey || (text === '' && st.kind === 'idle')) return next(e)

    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const { send, clear } = actions($, { url, label, sender })

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text bold>{`Discord · ${label}`}</Text>
          <Text dimColor>{`posts as ${sender} · ${text.length} / ${MAX_LEN}`}</Text>
        </Box>
        {text !== '' && (
          <Input
            key="draft"
            rows={2}
            value={text}
            placeholder="Edit the draft, then press Send."
            submitLabel="save"
            onInput={value => void update($, draft, () => value)}
            onSubmit={value => void update($, draft, () => value)}
          />
        )}
        <Box flexDirection="row" gap={1}>
          {text !== '' && <Button key="send" onPress={send}>Send</Button>}
          <Button key="clear" onPress={clear}>{text === '' ? 'Dismiss' : 'Clear'}</Button>
          {st.text !== '' && (
            <Text color={st.kind === 'error' ? 'red' : st.kind === 'sent' ? 'green' : undefined}>{st.text}</Text>
          )}
        </Box>
      </Box>
    )
  })
}
