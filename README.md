# discord-draft

A Claude Code mod that adds a **Discord pane** beside the chat. Claude drafts a message into the pane; you read it, edit it, and press **Send** to post it to one Discord channel through that channel's webhook. Claude cannot send by itself: nothing leaves until you press Send.

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

- Ask Claude: "draft a Discord message to the team about …". Claude calls the `draft_discord` tool, which puts the text in the pane.
- Edit the text if you want, then press **Send**, or **Clear** to drop it.
- The pane shows green "Sent to #channel at HH:MM" when Discord accepted it, or red with the reason (the draft is kept).
- Mentions such as `@everyone`, roles and users never ping: the mod turns them off on every post.
- Discord's limit is 2000 characters per message; the pane shows the count.

## Develop

`claude plugin validate .` and `claude plugin test .` check the mod; the tests are in `tests/`.
