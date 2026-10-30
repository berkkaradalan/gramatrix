# Agent guide

Instructions for anyone, human or AI, changing this repository.

## Rules

1. **English only.** Code, comments, identifiers, strings, docs and commit messages use English
   and ASCII characters. `npm run check:ascii` enforces this.
2. **Write for the next person.** The app must be friendly to people who use it and the code must
   be easy to read for people who did not write it.
3. **Tests and docs stay current.** A change is not finished until its tests and the matching page
   in `docs/` are updated.
4. **No machine specific details.** Never commit personal paths, user names, keys or tokens.

## Layout

| Path            | Purpose                                                                       |
| --------------- | ----------------------------------------------------------------------------- |
| `src/shared/`   | Types and the RPC contract. Imported by every process. Has no runtime deps.   |
| `src/main/`     | Electron main process: window, tray, dialogs and encrypted secrets.           |
| `src/preload/`  | Exposes `window.gramatrix` to the renderer.                                   |
| `src/host/`     | Utility process: database, agent runs, schedules, chat channels. No Electron. |
| `src/renderer/` | React user interface.                                                         |
| `tests/e2e/`    | Playwright tests against the built app.                                       |
| `docs/`         | Documentation for users and contributors.                                     |

## Conventions

- The renderer reaches everything through `window.gramatrix`. Add a method to `RpcMethods` in
  `src/shared/rpc.ts`, then register it in a host service with `router.handle`.
- Host code takes a `HostContext` instead of importing Electron, so it runs under Vitest.
- Decrypted secrets stay in the main and host processes. The renderer can write a secret and ask
  whether it exists, but it can never read one.
- Change the schema by appending to `MIGRATIONS`. Never edit an existing migration.
- Tests sit next to the code as `*.test.ts`. Use `createTestHost` from `src/host/testing.ts`.

## Commands

| Command            | Purpose                                       |
| ------------------ | --------------------------------------------- |
| `npm run dev`      | Run the app with hot reload.                  |
| `npm run check`    | ASCII check, type check, lint and unit tests. |
| `npm run test:e2e` | Build the app and run the Playwright tests.   |

Run `npm run check` before calling any work done.
