# Gramatrix website

The landing page and documentation, built with Astro and Starlight.

```sh
npm install
npm run dev
```

Open <http://localhost:4321>. Node.js 22.12 or newer is required.

## How it is put together

| Path                    | Purpose                                                 |
| ----------------------- | ------------------------------------------------------- |
| `src/pages/index.astro` | The landing page.                                       |
| `src/pages/*.ts`        | `robots.txt` and `sitemap.xml`.                         |
| `src/components/`       | Icons, and Starlight overrides for one docs theme.      |
| `src/scripts/`          | ASCII backgrounds, feature tour and download buttons.   |
| `src/data/site.ts`      | Links, copy and providers.                              |
| `scripts/sync-docs.mjs` | Generates the docs pages. Runs before `dev` and `build` |

Documentation lives in the repository's `docs/` folder. Do not edit the generated files in
`src/content/docs/docs/`.

## Downloads

The Linux rows find their files in the latest GitHub release when the page loads. Until a release
exists, they are disabled and the page says so.

Mac visitors get the install command instead. `public/install.sh` is served at
`gramatrix.com/install.sh`. See [CONTRIBUTING.md](../CONTRIBUTING.md#releasing).

## Replacing the logo

Replace `public/logo.svg`, `src/assets/logo.svg` and `public/favicon.svg`, then the PNG exports:
`public/favicon.ico` (48px), `public/icon.png` (512px), `public/apple-touch-icon.png` (180px, no
transparency) and `public/og.png` (1200x630), the image shown when a link is shared.

## Search and link previews

`SITE_URL` in `astro.config.mjs` is the canonical address. Sitemaps, `robots.txt`, canonical links
and preview images are all built from it, so change it if the site moves to another domain.

## Deploying to Vercel

Import the repository. `vercel.json` at the repository root sets everything, so no project settings
are needed.
