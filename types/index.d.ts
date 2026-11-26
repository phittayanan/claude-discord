export type SendStatus = { kind: 'idle' | 'sending' | 'sent' | 'error'; text: string }

declare module 'claude-code' {
  interface PluginState {
    'discord-draft': { draft: Shaped<string>; status: Shaped<SendStatus> }
  }
}
