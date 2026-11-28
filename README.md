# discord-draft

A Claude Code mod that adds a **Discord band** above the prompt and a **Discord pane** beside the chat. Claude drafts a message into the pane; you read it, edit it, and press **Send** to post it to one Discord channel through that channel's webhook. Claude cannot send by itself: nothing leaves until you press Send.

With a read-only bot set up (see [Reading](#reading)), Claude can also read the channel's recent messages as text with the `read_discord` tool.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install discord-draft --marketplace phittayanan/claude-discord
```

Answer `y` to add the marketplace, then pick a scope (user scope makes it available in every session).

## Set up

1. In Discord, open the channel → **Edit Channel → Integrations → Webhooks → New Webhook**, name it, and **Copy Webhook URL**. You need the channel's *Manage Webhooks* permission.
2. In Claude Code, type `/discord` to open the pane, paste the URL into the box at the top and press Enter. The pane says "Webhook saved".
3. Optional: set `sender_name` (the name Discord shows, for example `yourname (via Claude)`) and `channel_label` (the channel name shown in the pane) in the plugin's settings.

The webhook URL is a secret: anyone who has it can post to that channel. Paste it only into the pane, never into a chat, a repository or a commit. It is kept in `~/.claude/settings.json` on your computer. If it leaks, delete the webhook in Discord and make a new one.

## Use

- Ask Claude: "draft a Discord message to the team about …". Claude calls the `draft_discord` tool, which puts the text in the band above the prompt (and in the `/discord` pane). The band shows only while there is a draft or a send result.
- Edit the text if you want, then press **Send** in the band or the pane, or **Clear** to drop it. `[-]` beside the band folds it away.
- The pane shows green "Sent to #channel at HH:MM" when Discord accepted it, or red with the reason (the draft is kept).
- Mentions such as `@everyone`, roles and users never ping: the mod turns them off on every post.
- Discord's limit is 2000 characters per message; the pane shows the count.

## Reading

A webhook can only post, so reading goes through a bot of your own that can see one channel and nothing else. The mod only ever calls `GET /channels/{channel_id}/messages`: it has no code that sends, edits, deletes or reacts with the bot.

1. In the [Discord Developer Portal](https://discord.com/developers/applications), open your application → **Bot**:
   - turn **Public Bot** off, so only you can add it to a server;
   - under **Privileged Gateway Intents**, turn **Message Content Intent** on (without it every message comes back empty), then **Save Changes**.
2. **OAuth2 → URL Generator**: tick the scope **`bot`** only, and under Bot Permissions tick only **View Channels** and **Read Message History**. Open the generated URL, pick the team's server and **Authorize**. If the channel is private, also allow the bot (or its role) to view that channel.
3. Back on **Bot**, press **Reset Token** and **Copy** it.
4. In Claude Code, type `/discord`, paste the token into the bot token box and press Enter. The pane says "Bot token saved" and from then on shows only "bot token set (hidden)".
5. `channel_id` defaults to the team's #talk (`1575536526782111934`). To read another channel, turn on Developer Mode in Discord (User Settings → Advanced), right-click the channel → **Copy Channel ID**, and set `channel_id` in the plugin's settings.

Then ask Claude, for example, "read the last 20 messages in #talk". `read_discord` takes `limit` (1 to 100, default 30) and `before` (a message id, to page back), and lists messages oldest first with author, time in +07:00, text, embed titles and links, and attachment names. Errors say what to fix: no token, a wrong token (401), missing View Channel or Read Message History (403), Message Content Intent off, or a rate limit (429, with the wait).

The bot token is a secret: anyone with it can act as the bot. Paste it only into the pane, never into a chat, a repository or a commit. It is kept in `~/.claude/settings.json` on your computer and hidden from `/config`. If it leaks, press **Reset Token** in the Developer Portal right away and paste the new one.

Use a bot token only. Never use your own user account's token ("self-bot"): it is against Discord's Terms of Service and can get the account banned.

## Develop

`claude plugin validate .` and `claude plugin test .` check the mod; the tests are in `tests/`.
