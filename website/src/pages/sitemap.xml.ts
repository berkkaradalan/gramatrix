import type { APIRoute } from 'astro'

// Serves the conventional address. @astrojs/sitemap writes the page list to sitemap-0.xml at build
// time, so this link only resolves in a built site, not under `npm run dev`.
export const GET: APIRoute = ({ site }) =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${new URL('/sitemap-0.xml', site)}</loc></sitemap>
</sitemapindex>
`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } }
  )
