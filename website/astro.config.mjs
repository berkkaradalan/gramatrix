import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'

// The canonical address. Sitemaps, robots.txt and link previews are all built from it.
const SITE_URL = 'https://www.gramatrix.com'
const SOCIAL_IMAGE = `${SITE_URL}/og.png`

const tag = (name, attrs) => ({ tag: name, attrs })

export default defineConfig({
  site: SITE_URL,
  redirects: { '/docs': '/docs/user-guide/' },
  devToolbar: { enabled: false },
  integrations: [
    starlight({
      title: 'Gramatrix',
      description: 'Documentation for Gramatrix, a desktop AI coding agent.',
      logo: { src: './src/assets/logo.svg' },
      favicon: '/favicon.svg',
      head: [
        tag('link', { rel: 'icon', href: '/favicon.ico', sizes: '48x48' }),
        tag('link', { rel: 'icon', href: '/icon.png', type: 'image/png', sizes: '512x512' }),
        tag('link', { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }),
        tag('meta', { property: 'og:image', content: SOCIAL_IMAGE }),
        tag('meta', { property: 'og:image:width', content: '1200' }),
        tag('meta', { property: 'og:image:height', content: '630' }),
        tag('meta', { name: 'twitter:image', content: SOCIAL_IMAGE })
      ],
      components: {
        ThemeProvider: './src/components/DarkTheme.astro',
        ThemeSelect: './src/components/NoThemeSelect.astro'
      },
      customCss: [
        '@fontsource-variable/inter',
        '@fontsource-variable/jetbrains-mono',
        './src/styles/docs.css'
      ],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/berkkaradalan/gramatrix' }
      ],
      sidebar: [
        { label: 'Start here', items: [{ slug: 'docs/user-guide' }] },
        {
          label: 'Features',
          items: [
            { slug: 'docs/agent' },
            { slug: 'docs/providers' },
            { slug: 'docs/scheduled-jobs' },
            { slug: 'docs/channels' },
            { slug: 'docs/usage' }
          ]
        },
        {
          label: 'Contributors',
          items: [
            { slug: 'docs/architecture' },
            { slug: 'docs/interface' },
            { slug: 'docs/contributing' }
          ]
        }
      ]
    })
  ]
})
