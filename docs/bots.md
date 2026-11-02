# Bots

A bot is an agent with its own name, its own personality and a memory that lasts between chats.
Plain Gramatrix chats start fresh every time. A bot remembers who you are, how you like to work
and what it learned, and brings that into every new chat.

## Create a bot

Open **Bots** in the sidebar and create one. A bot has:

- **A name.** The bot introduces itself with it, and chats with it show it.
- **A soul.** A few lines about who the bot is and how it should behave, in your own words. For
  example: "You are calm and direct. Answer in Turkish unless I write in English. Point out risks
  before you change anything." The soul goes into every request, so keep it short. It can be at
  most 4,000 characters.
- **A picture.** The first letter of its name, one of the icons that come with Gramatrix, or a PNG
  or JPEG from your computer. A picture is cropped to a square, shrunk and kept with the bot.
- **A model.** New chats with the bot start with it. You can still change the model of a chat.
- **A default project, if you want one.** New chats with the bot start in that folder, which suits
  a bot made for one place, such as a bot that tidies your desktop. Leave it empty for a bot you
  use everywhere. Removing the project from Gramatrix clears it.
- **Learn from chats.** When this is on, the bot reviews its chats now and then to update its
  memory. See [How a bot learns](#how-a-bot-learns).

Start a chat from the bot's page, or pick the bot in the composer on Home. A chat with a bot can
work in a project, with the same tools and permission modes as any other chat, or without one.
Without a project the bot cannot see your files. To give it a folder, use the **No project** button
at the top of the chat; the chat keeps its history and the bot remembers what it learned.

## Memory

A bot keeps two short lists:

- **About you:** who you are, your preferences and the corrections you gave. Up to 1,375
  characters.
- **Notes:** everything else worth keeping, such as facts about your projects and conventions.
  Up to 2,200 characters.

The whole memory goes into every request. The limits keep that cheap, and they make the bot merge
or replace old entries instead of piling up new ones. When a list is full, the bot sees its
entries and has to make room first.

The bot's page shows every entry. You can add, edit and remove entries there, and your changes
apply from the next message on. A change the bot makes during a chat applies from its next chat.

## How a bot learns

A bot changes its memory with its `memory` tool, and the chat shows each change. It does this:

- **When it decides to.** For example after you tell it your name or correct the way it works.
  This works in every permission mode, because memory lives inside Gramatrix and changes nothing
  on your computer.
- **In a review, if Learn from chats is on.** After every 10 messages you send in a chat, the bot
  reads the conversation again in the background and saves what will matter later. The review
  never slows down or interrupts the chat. It uses tokens from your key, and the Usage page lists
  them under **Bot memory**.

## Safety

What the bot writes to memory comes back in every later request. A web page or a file it read
could try to plant an instruction there, so Gramatrix refuses writes that:

- tell the agent to ignore its instructions or mention the system prompt,
- ask it to hide something from you,
- ask it to send keys, tokens or passwords somewhere,
- look like a secret key,
- contain invisible characters.

The bot is told that memory holds notes, not instructions. These checks catch the common attempts,
not every possible one, so look through the memory page now and then. What you write yourself is
not checked, only kept within the limits.

Memory never leaves your computer except as part of the requests to your model provider. It is
stored with your chats in the Gramatrix database.

## Bots in channels and scheduled jobs

A Telegram or Slack channel and a scheduled job can each use a bot instead of plain Gramatrix. Pick
it in the channel settings or the job editor.

A memory holds personal facts, so it is only used where only you read along: direct messages and
scheduled jobs. In a group or a Slack channel, the bot keeps its soul but gets no memory and no
`memory` tool. That stays true when you open such a chat in Gramatrix and continue it there. See
[Chat channels](channels.md).

## Delete a bot

Deleting a bot deletes its memory. Its chats stay and become plain Gramatrix chats, and channels or
jobs that used it go back to plain Gramatrix.
