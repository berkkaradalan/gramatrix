# Chat channels

Channels let you talk to the agent from Telegram or Slack. Both connect outwards from your
computer, so you do not need a public address. Channels work while the app is running, including
when it is in the tray.

## Security model

Anyone who can message the agent can act on your project, so access is closed by default.

- **Only paired accounts reach the agent.** Everyone else gets a refusal and their text is dropped.
- **Pairing codes** are random, work once, last 10 minutes and are only accepted in a direct
  message. Creating a new code cancels the previous one, and so does restarting the app.
- **A code posted in a group is cancelled.** Other members could read it, so the bot cancels it and
  asks you to create a new one. The bot only sees group messages that mention it, so a code posted
  without a mention cannot be cancelled this way. Create a new code if that happens.
- **Wrong codes are limited.** Five wrong codes lock that account for 15 minutes. Twenty wrong codes
  from anyone lock pairing on the channel until you create a new code or 15 minutes pass.
- **Channels start as `read-only`.** Nobody can approve actions from a chat, so anything that would
  need approval is denied. Raising the mode lets paired accounts change your files or run commands
  without you seeing it first. Only do this if you trust every paired account.
- **Other bots are ignored.**
- **A bot's memory stays private.** See [Answering as a bot](#answering-as-a-bot).

Remove access at any time from the channel settings. Disabling a channel or saving its settings
cancels its active runs. Messages still waiting are dropped when the channel is disabled, and run
with the new settings when it stays enabled. Revoking a pairing refuses that account's waiting
messages but does not cancel a run already in progress.

## Telegram setup

1. Message [@BotFather](https://t.me/BotFather), send `/newbot` and copy the token.
2. In Gramatrix, open the Telegram channel, paste the token, optionally pick a project, and enable it.
3. Create a pairing code and send it to your bot in a direct message.

Telegram allows one connection per bot token, so do not use the token in another running program.

## Slack setup

1. Create an app at [api.slack.com/apps](https://api.slack.com/apps).
2. Enable **Socket Mode** and create an app-level token with the `connections:write` scope. It
   starts with `xapp-`.
3. Under **Event Subscriptions**, subscribe to the bot events `app_mention` and `message.im`.
4. Under **OAuth and Permissions**, add the bot scopes `app_mentions:read`, `chat:write`,
   `im:history`, `im:read` and `users:read`, then install the app and copy the bot token. It
   starts with `xoxb-`.
5. In Gramatrix, open the Slack channel, paste both tokens, optionally pick a project, and enable it.
6. Create a pairing code and send it to your bot in a direct message.

## Using a channel

- Send a direct message, or mention the bot in a group. Other group messages are ignored.
- Each conversation maps to one chat in Gramatrix, shown in the chat list under its project.
- A channel does not need a project. Without one, conversations are general chats: the agent can
  talk but has no file or command tools.
- Send `/new` to start a fresh chat.
- Messages in one conversation run in order. Long replies arrive in several messages.

## Answering as a bot

A channel answers as plain Gramatrix unless you pick a [bot](bots.md) under **Bot** in its
settings. Picking a bot also picks its model, which you can change again. The bot then answers
with its name and soul, and its chats show up as chats with that bot. Changing the bot starts a new
chat in every conversation. Deleting the bot turns the channel back into plain Gramatrix.

A bot's memory holds personal facts about you, so it is only used where nobody else reads along:

| Where the message comes from                  | Soul | Memory and `memory` tool |
| --------------------------------------------- | ---- | ------------------------ |
| Telegram private chat with the bot            | Yes  | Yes                      |
| Slack direct message with the bot             | Yes  | Yes                      |
| Telegram group, supergroup or channel         | Yes  | No                       |
| Telegram Business chat                        | Yes  | No                       |
| Slack channel, private channel or group DM    | Yes  | No                       |
| Anything the platform does not clearly report | Yes  | No                       |

In a shared conversation the bot is told that its memory is not available and that it should not
share personal details. It cannot add to its memory there either.

## For developers

- `src/host/channels/adapter.ts` is the whole contract with a platform. Only
  `chat-sdk-adapter.ts` imports vendor packages, so replacing one affects a single file.
- To add a platform, extend `CHANNEL_KINDS` in `src/shared/types.ts` and add a case to
  `createVendorAdapter`.
- `channel-service.ts` cancels exposed codes first, then checks that the channel is enabled, then
  checks pairing. Keep that order, and keep all three ahead of any agent run.
- Chat SDK uses an in-memory state adapter because it only needs short-lived deduplication here.
  Durable state lives in the `channels`, `channel_pairings` and `channel_chats` tables.
- Tokens are read through `context.getSecret`. Saving a channel always reconnects, so write the
  secret before calling `channels.configure`.
- `InboundMessage.isDirect` is true only when the platform confirms a one to one conversation.
  Chat SDK's `thread.isDM` alone is not enough, because it calls a Telegram Business chat a direct
  message. `isDirectConversation` in `chat-sdk-adapter.ts` also requires the raw message to say so:
  Telegram `chat.type` is `private` with no `business_connection_id`, and Slack `channel_type` is
  `im`. A missing value counts as shared.
- `isDirect` gates pairing and becomes `withMemory` on the headless run, which decides whether a
  bot gets its memory and `memory` tool. The flag is off unless a caller sets it.
- `channels.bot_id` links the bot. A thread chat is reused only while both the project and the bot
  still match the channel.
