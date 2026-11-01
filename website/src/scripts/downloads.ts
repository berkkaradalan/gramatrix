// Connects the download buttons to the latest GitHub release. File names can change between
// versions, so each button finds its file by type instead of relying on a fixed link. The Mac app
// installs through website/public/install.sh, so Mac visitors are sent to that command instead.

const LATEST_RELEASE_API = 'https://api.github.com/repos/berkkaradalan/gramatrix/releases/latest'

interface ReleaseAsset {
  name: string
  size: number
  browser_download_url: string
}

interface Release {
  tag_name: string
  assets: ReleaseAsset[]
}

type Platform = 'linux-deb' | 'linux-appimage'

const MATCHERS: Record<Platform, (name: string) => boolean> = {
  'linux-deb': (name) => name.endsWith('.deb'),
  'linux-appimage': (name) => name.endsWith('.AppImage')
}

const LINUX_LABEL = 'Download for Linux'
const MAC_LABEL = 'Install on Mac'
const COPIED_MESSAGE_MS = 1500

function detectSystem(): 'mac' | 'linux' | null {
  const agent = navigator.userAgent
  if (/Windows/i.test(agent) || /Android|iPhone|iPad/i.test(agent)) return null
  if (/Macintosh|Mac OS X/i.test(agent)) return 'mac'
  return /Linux/i.test(agent) ? 'linux' : null
}

function formatSize(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`
}

function setPrimary(link: HTMLAnchorElement, label: string, href: string): void {
  link.href = href
  const text = link.querySelector('[data-label]')
  if (text) text.textContent = label
}

async function fetchRelease(): Promise<Release | 'none' | 'unknown'> {
  try {
    const response = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' }
    })
    if (response.status === 404) return 'none'
    return response.ok ? ((await response.json()) as Release) : 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function connectDownloads(): Promise<void> {
  const system = detectSystem()
  const primaries = document.querySelectorAll<HTMLAnchorElement>('[data-primary-download]')
  document.documentElement.dataset['platform'] = system ?? 'other'
  if (system === 'mac') {
    primaries.forEach((link) => setPrimary(link, MAC_LABEL, '#download'))
    document.querySelector('[data-mac-install]')?.classList.add('is-recommended')
  }
  if (system === 'linux') {
    primaries.forEach((link) => setPrimary(link, LINUX_LABEL, '#download'))
    document.querySelector('[data-card="linux-deb"]')?.classList.add('is-recommended')
  }

  const release = await fetchRelease()
  const status = document.querySelector('[data-release-status]')
  if (release === 'unknown') return

  if (release === 'none') {
    document.documentElement.dataset['release'] = 'none'
    primaries.forEach((link) => setPrimary(link, 'Download', '#download'))
    if (status) status.textContent = 'The first release is coming soon.'
    return
  }

  if (status) status.textContent = `Latest release: ${release.tag_name}`
  for (const card of document.querySelectorAll<HTMLAnchorElement>('[data-card]')) {
    const key = card.dataset['card'] as Platform
    const asset = release.assets.find(({ name }) => MATCHERS[key](name))
    if (!asset) continue
    card.href = asset.browser_download_url
    const size = card.querySelector('[data-size]')
    if (size) size.textContent = formatSize(asset.size)
    if (system === 'linux' && key === 'linux-deb') {
      primaries.forEach((link) => setPrimary(link, LINUX_LABEL, asset.browser_download_url))
    }
  }
}

export function connectCopyButtons(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
    const label = button.textContent
    button.addEventListener('click', async () => {
      await navigator.clipboard.writeText(button.dataset['copy'] ?? '')
      button.textContent = 'Copied'
      setTimeout(() => (button.textContent = label), COPIED_MESSAGE_MS)
    })
  }
}
