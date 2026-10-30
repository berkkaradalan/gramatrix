import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { Readable } from 'node:stream'

export const MEDIA_SCHEME = 'gramatrix-media'
export const BACKGROUNDS_HOST = 'backgrounds'
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024

const CONTENT_TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.webm': 'video/webm' }

/** Generated names look like this, which leaves no room for path tricks. */
const SAFE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|webm)$/

export function isSafeVideoName(name: string): boolean {
  return SAFE_NAME.test(name)
}

/**
 * Copies a video into the backgrounds folder under a generated name and returns that name.
 * Only the newest video is kept, because nothing can refer to the older ones any more.
 */
export async function importVideo(sourcePath: string, folder: string): Promise<string> {
  const extension = extname(sourcePath).toLowerCase()
  if (!(extension in CONTENT_TYPES)) throw new Error('Choose an MP4 or WebM video.')
  const { size } = await stat(sourcePath)
  if (size > MAX_VIDEO_BYTES) throw new Error('Choose a video under 200 MB.')

  await mkdir(folder, { recursive: true })
  const name = `${randomUUID()}${extension}`
  await copyFile(sourcePath, join(folder, name))
  for (const existing of await readdir(folder)) {
    if (existing !== name && isSafeVideoName(existing)) await rm(join(folder, existing))
  }
  return name
}

interface ByteRange {
  start: number
  end: number
}

/** Reads a single range header. Returns null when it cannot be satisfied. */
export function parseRange(header: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const [, first = '', last = ''] = match
  if (first === '' && last === '') return null
  if (first === '') {
    const suffix = Number(last)
    return suffix > 0 ? { start: Math.max(size - suffix, 0), end: size - 1 } : null
  }
  const start = Number(first)
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1)
  return start <= end && start < size ? { start, end } : null
}

function notFound(): Response {
  return new Response('Not found', { status: 404 })
}

/**
 * Answers the media protocol. It serves files directly inside `folder` and nothing else.
 * Range support matters: video elements seek with it, and looping fails without it.
 */
export async function videoResponse(request: Request, folder: string): Promise<Response> {
  const url = new URL(request.url)
  if (url.hostname !== BACKGROUNDS_HOST) return notFound()
  let name: string
  try {
    name = decodeURIComponent(url.pathname.slice(1))
  } catch {
    return notFound()
  }
  if (!isSafeVideoName(name)) return notFound()

  const path = join(folder, name)
  const size = await stat(path).then(
    (info) => (info.isFile() ? info.size : null),
    () => null
  )
  if (size === null) return notFound()

  const headers: Record<string, string> = {
    'Accept-Ranges': 'bytes',
    'Content-Type': CONTENT_TYPES[extname(name)] ?? 'application/octet-stream'
  }
  const rangeHeader = request.headers.get('range')
  if (!rangeHeader) {
    const body = Readable.toWeb(createReadStream(path)) as ReadableStream
    return new Response(body, { headers: { ...headers, 'Content-Length': String(size) } })
  }

  const range = parseRange(rangeHeader, size)
  if (!range) {
    return new Response(null, {
      status: 416,
      headers: { ...headers, 'Content-Range': `bytes */${size}` }
    })
  }
  const { start, end } = range
  const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
  return new Response(body, {
    status: 206,
    headers: {
      ...headers,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`
    }
  })
}
