# Chat channels

Channels let you talk to the agent from Telegram or Slack. Both connect outwards from your
computer, so you do not need a public address. Channels work while the app is running, including
when it is in the tray.

## Security model

Anyone who can message the agent can act on your project, so access is closed by default.

- **Only paired accounts reach the agent.** Everyone else gets a refusal and their text is dropped.
- **Pairing codes** are random, work once, last 10 minutes and are only accepted in a direct
  message. A Telegram pairing link carries the code, so treat the link and its QR code like the
  code itself. Creating a new code cancels the previous one, and so does restarting the app.
- **A code posted in a group is cancelled.** Other members could read it, so the bot cancels it and
  asks you to create a new one. The bot only sees group messages that mention it, so a code posted
  without a mention cannot be cancelled this way. Create a new code if that happens.
- **Wrong codes are limited.** Five wrong codes lock that account for 15 minutes. Twenty wrong codes
  from anyone lock pairing on the channel until you create a new code or 15 minutes pass.
- **Channels start as `read-only`.** Nobody can approve actions from a chat, so anything that would
  need approval is denied. Raising the mode lets paired accounts change your files or run commands
  without you seeing it first. Only do this if you trust every paired account.
- **A paired account can reach every project.** `/project` moves a chat to any project you added
  to Gramatrix, not only the one the channel uses.
- **A chat can never raise its permission mode.** `/mode` only offers the mode set in the app and
  safer ones.
- **Other bots are ignored.**
- **A bot's memory stays private.** See [Answering as a bot](#answering-as-a-bot).

Remove access at any time from the channel settings. Disabling a channel or saving its settings
cancels its active runs. Messages still waiting are dropped when the channel is disabled, and run
with the new settings when it stays enabled. Revoking a pairing refuses that account's waiting
messages but does not cancel a run already in progress.

## Telegram setup

1. Message [@BotFather](https://t.me/BotFather), send `/newbot` and copy the token.
2. In Gramatrix, open **Channels**, choose **Set up** on Telegram and paste the token. Saving it
   turns the channel on, and the dialog shows the bot's name once it is connected.
3. Choose **Pair my account**. Scan the QR code with your phone, or choose **Open in Telegram** on
   this computer, then press **Start** in Telegram. The bot answers "Paired." and the dialog shows
   your name.

If the link does not open, send `/pair CODE` to the bot instead, with the code the dialog shows.
Opening the bot with a plain **Start** tells you how to pair.

Telegram allows one connection per bot token, so do not use the token in another running program.

## Slack setup

1. Create an app at [api.slack.com/apps](https://api.slack.com/apps).
2. Enable **Socket Mode** and create an app-level token with the `connections:write` scope. It
   starts with `xapp-`.
3. Under **Event Subscriptions**, subscribe to the bot events `app_mention` and `message.im`.
4. Under **OAuth and Permissions**, add the bot scopes `app_mentions:read`, `chat:write`,
   `im:history`, `im:read` and `users:read`, then install the app and copy the bot token. It
   starts with `xoxb-`.
5. In Gramatrix, open **Channels**, choose **Set up** on Slack and paste both tokens. Saving them
   turns the channel on.
6. Choose **Pair my account** and send the code it shows to your bot in a direct message. Send the
   code alone, without `/pair`, because Slack treats messages that start with `/` as its own
   commands.

## Using a channel

- Send a direct message, or mention the bot in a group. Other group messages are ignored.
- Each conversation maps to one chat in Gramatrix, shown in the chat list under its project.
- A channel does not need a project. Without one, conversations are general chats: the agent can
  talk but has no file or command tools.
- Pairing messages, such as `/start` or a code sent again after pairing, never reach the agent.

## Commands

On Telegram, type `/` in a chat with the bot to see these commands in a menu.

| Command    | What it does                                                             |
| ---------- | ------------------------------------------------------------------------ |
| `/new`     | Starts a new chat. The choices below stay.                               |
| `/stop`    | Stops the answer that is running and drops messages waiting after it.    |
| `/status`  | Shows the project, model, bot and permission mode of this chat.          |
| `/model`   | Chooses the model for this chat.                                         |
| `/project` | Chooses the project for this chat, or none.                              |
| `/bot`     | Chooses who answers in this chat: plain Gramatrix or one of your bots.   |
| `/mode`    | Chooses the permission mode for this chat, up to the one set in the app. |
| `/help`    | Lists the commands.                                                      |

`/model`, `/project`, `/bot` and `/mode` show the options as buttons. You can also type the choice:
`/model 2` picks the second option, `/model sonnet` picks the one whose name contains "sonnet", and
`/model default` goes back to the setting in the app. `/model` lists the channel model, your default
model and the models you starred or used recently. For any other model, type it as
`provider/model`, such as `/model openai/gpt-5.5`.

Choices apply to one chat only: a private chat with the bot or one group. Everything else still
uses the channel settings. When you change a setting in the app, chats that chose their own value
for it switch to the new one. Changing the project or the bot starts a new chat in Gramatrix.
`/stop`, `/status` and the choice commands answer at once, even while an answer is running.

Slack treats every message that starts with `/` as one of its own commands, so these commands do
not work there yet.

- Messages in one conversation run in order. Long replies arrive in several messages.

## Answering as a bot

A channel answers as plain Gramatrix unless you pick a [bot](bots.md) under **Answers as** in its
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
- Telegram marks `/pair CODE` and `/start CODE` as bot commands, and Chat SDK sends those to
  `onSlashCommand` instead of the message handlers. `chat-sdk-adapter.ts` forwards them as
  messages. `telegram-flow.test.ts` runs the real adapter against a fake Bot API to guard this.
- The pairing link is `https://t.me/<bot>?start=<code>`. The bot name comes from the adapter's
  `accountName`, so `channels.createPairingCode` returns no link until the bot has connected.
- `commands.ts` lists the chat commands and builds their replies. `ChatSdkAdapter.start` hands the
  list to Telegram's `setMyCommands`. Buttons carry the command they stand for, such as
  `/model 2`, so a tap goes through `actionAsMessage` and the same checks as typed text.
- Per chat choices live in the `channel_threads` table as JSON, read through `ThreadChoiceStore`.
  `ChannelService.threadSettings` applies them on top of the channel and caps the permission mode.
- Commands other than `/new` skip the per thread queue, so they answer during a run. `/stop`
  aborts the run and raises the thread's epoch, which makes queued messages drop themselves.
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
