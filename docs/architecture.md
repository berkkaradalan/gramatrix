# Architecture

Gramatrix is an Electron app made of three processes.

```
+-----------+   window.gramatrix    +--------+   parent port   +---------+
| Renderer  | <-------------------> |  Main  | <-------------> |  Host   |
| React UI  |         IPC           |        |                 | Node    |
+-----------+                       +--------+                 +---------+
                                    window, tray,              database, agent runs,
                                    dialogs, secrets           jobs, chat channels
```

## Processes

**Renderer** only draws the interface. It is sandboxed, has no Node access and loads local files.
Its one way out is `window.gramatrix`, defined in `src/preload/index.ts`.

**Main** owns everything that needs Electron APIs: the window, the tray, native dialogs and the
secret store. It routes each RPC call. Methods listed in `MAIN_METHODS` are handled there and all
others are forwarded to the host.

**Host** is an Electron utility process that does the slow work, so a long agent run or a busy
schedule can never freeze the window. It does not import Electron. `createHost` in
`src/host/create-host.ts` takes a `HostContext`, which lets the same code run under Vitest. If the
host crashes, the main process restarts it.

## RPC

`src/shared/rpc.ts` is the single contract. `RpcMethods` lists every request with its parameters
and result, and `HostEvents` lists every push notification. Both sides are typed from it.

## Data

Application data lives in the Electron `userData` directory.

| File           | Contents                                                           |
| -------------- | ------------------------------------------------------------------ |
| `gramatrix.db` | SQLite database: projects, chats, messages, jobs, channels, usage. |
| `secrets.json` | Encrypted secrets, readable only by the current user.              |

The database uses the `node:sqlite` module built into Electron, so there is no native dependency
to rebuild per platform. Schema changes are ordered migrations in `src/host/db/migrations.ts`,
tracked with `PRAGMA user_version`.

Migrations run with foreign keys off, because SQLite changes a constraint by rebuilding the table
and dropping the old table would otherwise cascade to its child rows. `migrate` refuses to commit a
migration that leaves more broken references than it found. Foreign keys are on for all normal work.

`chats.project_id` is null for a general chat. Jobs always have a project. A channel has an
optional project and creates general chats without one.

`src/host/providers/models-snapshot.json` is generated data, the last fallback for model pickers.
See [providers](providers.md).

## Secrets

API keys and bot tokens are encrypted with Electron `safeStorage`, which uses a key held by the
operating system keychain. The keychain is unlocked when the user logs in, so the app never asks
for a password of its own.

Decrypted values exist only in memory in the main process, and in the host when a request needs
one. The renderer can store a secret and ask whether one exists, but it can never read a value.

The provider dialog can reuse a key from an opencode install on the same machine. When the user asks
for it, the main process reads opencode's `auth.json`, sends the key to the host for a test request
and saves it only if the test passes. The value never reaches the renderer.

Two platform details matter:

- **macOS** may ask for keychain access once. Permission is tied to the code signature, so unsigned
  builds can be asked again after each rebuild. Release builds must be signed.
- **Linux** needs a secret service such as GNOME Keyring or KWallet. Without one, `safeStorage`
  falls back to a hardcoded password and offers no real protection. The app reports this as the
  `weak` backend and warns the user.

## Background work

Jobs and channels run in the host, so they stop when the app quits. Closing the window keeps the
app running in the tray unless the user turns that off in settings.
