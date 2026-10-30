# User guide

Gramatrix is a desktop coding agent for macOS and Linux. It uses your own API keys and works
inside folders you choose. You can also chat with it without any folder.

## First start

Setup has three steps, and every step can be skipped. If you close the app it continues where you
left off.

1. **Welcome.**
2. **Connect a provider.** Pick a card, paste a key and choose **Save and verify**.
3. **Pick a default model.** New chats start with this model.

After that you land on Home.

## Home

Gramatrix always opens on Home. Type a message and press `Enter`. The chat is created when you
send, so there is no separate new chat step.

The composer holds everything you need for that chat:

- **Project chip.** Defaults to **No project**, which is a general chat with no file access. Choose
  a project, or add one from the same menu, to let the agent work in that folder.
- **Model picker.** Changes the model for this chat.
- **Permissions.** Appears once a project is selected.

If no provider is connected, the composer invites you to connect one and opens the provider dialog
right there.

## Providers

Open **Settings**, then **Providers**. The same list appears during setup.

- **API keys** are pay per use. The provider bills you for every token.
- **Coding plans** are monthly subscriptions. Their keys only work on their own plan endpoint, so a
  plan key will not work on the API key card of the same company, and the other way around.

Each card opens a dialog with a hint about which key belongs there and a link to create one. A key
is tested before it is saved, so a rejected key never replaces one that works. If the failure is not
about the key, such as a rate limit, choose **Save anyway**. If opencode is installed and already has a key for that provider, **Use my opencode key** verifies
and saves it for you. **Disconnect** deletes the saved key from this
computer.

### How keys are stored

Keys are encrypted with your system keychain: Keychain on macOS and GNOME Keyring or KWallet on
Linux. The keychain unlocks when you log in, so Gramatrix never asks for a password while you work.
**Settings > General** shows the current state. If no keychain service is found on Linux,
Gramatrix warns you. Install and unlock GNOME Keyring or KWallet to protect your keys.

## Choosing a model

The model picker shows **Favorites** and **Recent** first, then one group per connected provider.
Each row shows the context size and the price per million tokens for input and output, or a
**Plan** badge for subscriptions.

- Type to search. Lists with hundreds of models stay fast.
- Use the star on a row to add a favorite.
- A wrench with a slash means the model has no tool support, so it cannot edit files or run
  commands.
- **Saved list** means the live list could not be reached. **Refresh** tries again.
- To use a model that is not listed, type its id and choose **Use ... with ...**.

Set your default model and manage favorites in **Settings > Models**.

## The sidebar

| Area      | What it does                                                           |
| --------- | ---------------------------------------------------------------------- |
| New chat  | Opens Home.                                                            |
| Search    | Finds chats and projects and jumps to any screen.                      |
| Scheduled | Lists jobs across all projects.                                        |
| Channels  | Connects Telegram and Slack.                                           |
| Projects  | Each project expands to its chats. Use **+** in the header to add one. |
| Chats     | General chats with no project.                                         |
| Settings  | Everything else.                                                       |

Hover a project for a new chat in that project and a menu to remove it. Removing a project deletes
its chats and jobs from Gramatrix but never touches the folder. A green dot on a chat means it is
running, and runs continue while you look at another chat.

### Keyboard

| Shortcut            | Action                 |
| ------------------- | ---------------------- |
| `Cmd+N` or `Ctrl+N` | New chat               |
| `Cmd+K` or `Ctrl+K` | Search                 |
| `Cmd+B` or `Ctrl+B` | Collapse the sidebar   |
| `Cmd+,` or `Ctrl+,` | Settings               |
| `Enter`             | Send                   |
| `Shift+Enter`       | New line               |
| `Esc`               | Close a dialog or menu |

## Working in a chat

The agent's actions appear as compact rows with an icon for each tool. Open a row to see its
details. Edits show as a diff, and commands show with their output. When the agent hands work to a
subagent, the actions of that subagent are nested under its name.

Messages and code blocks have a copy button. Use the round stop button to end a run. If a run
fails, **Retry** runs the last message again.

### Permissions

| Mode         | Reads files | Edits files | Runs commands |
| ------------ | ----------- | ----------- | ------------- |
| Read only    | Yes         | No          | No            |
| Ask first    | Yes         | Asks        | Asks          |
| Accept edits | Yes         | Yes         | Asks          |
| Full access  | Yes         | Yes         | Yes           |

When the agent needs approval, a card shows the exact command or a diff of the edit, with
**Approve** and **Deny**.

## Scheduled jobs

Jobs run a prompt on a schedule, always inside a project. Open **Scheduled** and choose **New
job**. Pick how often it repeats and the form shows when it runs next, or choose **Custom cron**
for a five field expression in your local time zone.

The play button runs a job right away, and **Show history** in its menu lists past runs with a link
to each transcript.

Jobs only run while Gramatrix is running. Keep **Keep running in the tray** on in Settings so they
continue after you close the window. Turn on **Catch up on startup** to run once after the app was
closed through a scheduled time.

Nobody is there to approve actions during a job, so anything that needs approval is denied. Pick
the permission mode that matches what the job must do.

## Channels

Channels let you talk to the agent from Telegram or Slack while Gramatrix is running. Choose **Set
up** on a card and follow the steps.

1. **Connect the bot.** For Telegram, create a bot with @BotFather and paste its token. For Slack,
   enable Socket Mode, then paste the bot token (`xoxb-`) and the app token (`xapp-`).
2. **Choose how it works.** Pick a model, and a project if the agent should work in a folder.
3. **Turn it on.**
4. **Pair yourself.** Choose **Create pairing code** and send `/pair CODE` to the bot within 10
   minutes.

Only paired people can use a channel. Anyone paired can reach your project, so pair only people you
trust. Approvals cannot be answered from a channel, so they are denied.

## Usage

**Usage** in the sidebar shows what your agents used: cost, tokens in and out, and runs. Pick a
range, then switch the chart between tokens and cost. Below it, usage is split by model, provider,
project and source, which tells chats, scheduled jobs, channels and subagents apart.

Subscription plans have no per token price, so their runs count toward tokens and runs but not
toward cost. A note under the totals says how many runs that covers.

Usage is recorded from the moment a run happens, so older chats have no data. In a chat, the numbers
at the top right show its tokens and cost, and clicking them shows the details. To see one project,
open the menu on its row in the sidebar and choose **Open project**.

## Settings

- **General:** keychain state, default permissions and the tray.
- **Providers:** connect and disconnect. Connected providers also stay at the bottom of the
  sidebar, one click away.
- **Models:** default model and favorites.
- **Appearance:** see below.
- **About:** version and where your data lives.

If a key fails verification, the dialog explains why. Open **Details** to see the raw error, and use
the copy button to report it.

### Appearance

**Theme.** Hover a theme to try it and click to keep it. The accent color can be changed on its own,
with presets or any color, and **Reset** returns to the color of the theme. You can also choose the
interface font and text size here.

**Code.** Code in chats, tool results and diffs is highlighted. The code theme follows the app on
**Auto**, or can be set separately. Line numbers, line wrapping, ligatures, the code font and size
are here too, with a live sample.

**Background.** A video plays behind Home and chats. Set its opacity and blur, turn it off, or use
**Choose video** to pick your own MP4 or WebM up to 200 MB. **Reset to default** returns to the
built in video. It pauses while the window is hidden, and with reduced motion it shows a still frame.

**Window.** Below 100% your desktop shows through the background while text stays solid. Moving
between 100% and a lower value reopens the window once, and running work keeps going. On Linux with
X11 this needs a compositor. If the background stays solid, your desktop does not support it.
