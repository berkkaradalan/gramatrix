# Contributing

Read [AGENTS.md](AGENTS.md) first. It holds the project rules, the repository layout and the code
conventions, and it applies to human and AI contributors alike.

## Setup

You need Node.js 22 or newer.

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

## Building installers

```sh
npm run dist:mac
npm run dist:linux
```

Installers are written to `dist/`. To build the current checkout and install it on a Mac the way a
user gets it, run this in the repository root. It needs no release:

```sh
./install.sh
```

## Continuous integration

`.github/workflows/ci.yml` runs `npm run check` and the end to end tests on Linux and macOS for every
pull request and every push to `main`. Linux must pass. macOS end to end results do not block a
merge yet. Dependabot opens weekly update pull requests for npm packages and GitHub Actions.

`main` is protected, so every change goes through a pull request. The Linux check and end to end
jobs must pass before it can merge. The rule lives in `.github/rulesets/protect-main.json`. To apply
it to a fork or a new repository, open **Settings > Rules > Rulesets**, choose **New ruleset > Import
a ruleset** and select that file.

## Releasing

1. Set the new version in `package.json` and merge that pull request to `main`.
2. Tag that commit and push the tag, for example `git tag v0.2.0 && git push origin v0.2.0`.

`.github/workflows/release.yml` then checks that the tag matches `package.json`, builds the `.deb`,
AppImage and Mac `.zip` installers, adds a `SHA256SUMS` file and publishes a GitHub release with
generated notes.

Mac builds only have an ad-hoc signature, because a real one needs an Apple Developer certificate.
macOS blocks such apps when they come from a browser, so Mac users install with
`website/public/install.sh`, served at `gramatrix.com/install.sh`. The script relies on two fixed
names, `Gramatrix-mac-<arch>.zip` from `electron-builder.yml` and `SHA256SUMS` from the release
workflow. The keychain can also ask for permission again after each update.

## Website

`website/` holds the landing page and docs site. See [website/README.md](website/README.md). The
docs pages are generated from `docs/`, so a docs change updates the site on its next build.

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
