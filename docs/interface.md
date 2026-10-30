# Interface

How the renderer in `src/renderer` is put together, for people changing it.

## Structure

| Path              | Purpose                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `src/lib/`        | Pure logic with unit tests: run reducer, models, schedules, diffs. |
| `src/state/`      | Stores and contexts: app data, navigation, overlays, runs, toasts. |
| `src/components/` | Shared pieces. `ui.tsx` holds the styled Radix primitives.         |
| `src/views/`      | Screens. `Shell.tsx` owns routing and global shortcuts.            |
| `src/styles/`     | `tokens.css` defines the design tokens. Other files only use them. |
| `src/assets/`     | Provider logos, referenced by `ProviderInfo.logo`.                 |

## Themes

`lib/themes.ts` holds one entry per id in `THEME_IDS`: label, dark or light, Shiki theme and colors
from the official palette. `themeTokens` derives everything else, such as hover states and borders,
and `applyAppearance` writes the result to the root element. To add a theme, add an id and an entry
and run the tests. `lib/themes.test.ts` computes contrast for every theme: text and secondary text
need 4.5, and the accent and status colors need 3 against the background.

`normalizeSettings` makes old settings safe, so a theme id that no longer exists becomes `matrix`.

## Design tokens

Every color, space, radius and font size is a token. Layout tokens live in `tokens.css`, and colors
come from the theme, so components never name a color directly.

- **Spacing** is a 4px grid: `--space-1` is 4px.
- **Type** has one scale, `--text-xs` to `--text-2xl`, relative to the text size setting.
- **Radius** is `--radius-sm`, `--radius-md`, `--radius-lg` or `--radius-full`.
- **Borders** are hairlines using `--border` or `--border-strong`.
- **Elevation** is one shadow, `--shadow-popover`, on anything that floats.
- **Accent** is rare: primary actions, focus, connected state, running indicators and charts.
- **Solid surfaces.** `--bg` and `--surface` turn translucent in a see through window. Anything that
  must stay readable over the video or the desktop uses `--bg-solid` or `--surface-solid`.

## Code highlighting

Highlighting runs in `workers/highlight.worker.ts`, so it can never delay typing. It uses Shiki's
fine grained imports and the JavaScript regex engine, which means the CSP needs no wasm. Languages
and themes load on first use, and anything outside `lib/languages.ts` renders as plain text.

`useHighlight` keeps the previous result until a new one arrives, and `CodeLine` only uses tokens
that still spell its exact text. While a reply streams, finished lines keep their colors and only
the line being written is plain, so there is no flicker. `CodeView` is the one component to use for
code, because it applies the code settings.

## Background video

`.chat-backdrop` is a single layer in `Shell`, shared by Home and chat so moving between them never
restarts the video. `--z-backdrop` keeps it behind content on `--z-content`. The bundled video is
bright on black, so dark themes use `screen` and light themes invert it and use `multiply`. That
keeps the background color of the theme. Custom videos are shown as they are.

Custom videos live in the `backgrounds` folder of the app data. `src/main/background-videos.ts`
imports them under generated names and serves them through the `gramatrix-media` protocol, which
accepts only those names and supports range requests so looping works.

## Transparency

A window cannot become transparent after it is created, and transparency costs resize and text
quality, so only windows that need it pay for it. When `windowOpacity` moves between 100 and a lower
value, the main process replaces the window. The new page reads the route it was showing from
storage, and the host keeps running through the change. Alpha only goes on surface tokens, so text
stays solid. On Linux `setOpacity` does nothing, so this always goes through the compositor.

## Usage charts

`components/usage` draws plain SVG with theme tokens, so charts work in every theme. There is one
measure on one axis at a time, and the Tokens and Cost control switches it. Bars use the accent,
labels use text tokens, and a hidden table gives screen readers the same numbers. Long ranges are
grouped by `bucketDays`, and breakdowns fold their tail into Other with `topRows`.

## Primitives

Use `Select`, `Menu`, `Dialog`, `Switch`, `Tooltip` and `IconButton` from `components/ui.tsx`. Never
use a native `select` element. Every icon only button goes through `IconButton`, which gives it a
tooltip and an accessible name.

Destructive actions call `confirm` from `useOverlays`. Failures from `useAction` become toasts.
Lists have a loading state with `Skeleton` and an empty state with `EmptyState`.

## Model picker

`ModelPicker` searches with `searchModels` instead of cmdk filtering, so ranking lives in tested
code. Groups render at most 40 rows until someone asks for the rest, which keeps lists of hundreds
of models fast. `state/model-store.ts` caches lists per provider and keeps an old list visible while
a refresh runs.

## Video background

`.chat-backdrop` in `ChatScreen` is the empty layer reserved for the animated video. It sits on
`--z-backdrop`, and the chat header, messages and composer sit above it on `--z-content`.

## Testing

Unit tests sit next to the code in `src/lib`. Playwright tests in `tests/e2e` come in two kinds:

- Most use `launchWithFakeBackend`, which loads the built renderer with a scripted
  `window.gramatrix`, including a 500 model list. No test code ships in the app.
- `launchApp` runs the real app against the real host. `agent-flow.spec.ts` drives it with a local
  fake provider.

To review the design, save screenshots at 1280x800 and 2558x1373:

```sh
npm run build
SCREENSHOT_DIR=some/folder npx playwright test screenshots
```
