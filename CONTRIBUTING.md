# Contributing

Read [AGENTS.md](AGENTS.md) first. It holds the project rules, the repository layout and the code
conventions, and it applies to human and AI contributors alike.

## Setup

```sh
npm install
npm run dev
```

`npm run dev` goes through `scripts/electron-vite.mjs`. It clears `ELECTRON_RUN_AS_NODE`, which
Electron based editors export. On Linux systems that block user namespaces it also turns the
Chromium sandbox off for that dev run and prints a warning. Packaged builds never do this.

## Before you open a pull request

```sh
npm run check
npm run test:e2e
```

`npm run check` covers the ASCII rule, types, lint and unit tests. The end to end tests need a
display. On a headless Linux machine, run them under a virtual display such as `xvfb-run`.

## Common tasks

### Add an RPC method

1. Add the method to `RpcMethods` in `src/shared/rpc.ts`.
2. Register a handler with `router.handle` in the host service that owns it.
3. Call it from the renderer through `window.gramatrix.invoke`.

### Change the database schema

Append a new entry to `MIGRATIONS` in `src/host/db/migrations.ts`. Never edit an existing entry,
because it may already have run on a user's machine.

### Add a setting

Add the field to `AppSettings` and `DEFAULT_SETTINGS` in `src/shared/types.ts`, then add a control
to the settings view. Settings are stored as JSON values, so no migration is needed.
