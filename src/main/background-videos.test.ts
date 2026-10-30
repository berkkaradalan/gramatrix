import { mkdtempSync, readdirSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAX_VIDEO_BYTES,
  importVideo,
  isSafeVideoName,
  parseRange,
  videoResponse
} from './background-videos'

const NAME = '12345678-1234-1234-1234-123456789abc.mp4'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'gramatrix-videos-'))
}

function folderWithVideo(): string {
  const folder = tempDir()
  writeFileSync(join(folder, NAME), '0123456789')
  return folder
}

function request(path: string, range?: string): Request {
  return new Request(`gramatrix-media://backgrounds/${path}`, {
    headers: range ? { range } : {}
  })
}

describe('importVideo', () => {
  it('copies a video under a generated name', async () => {
    const source = join(tempDir(), 'my clip.MP4')
    writeFileSync(source, 'video')
    const folder = join(tempDir(), 'backgrounds')
    const name = await importVideo(source, folder)
    expect(isSafeVideoName(name)).toBe(true)
    expect(readdirSync(folder)).toEqual([name])
  })

  it('rejects other file types', async () => {
    const source = join(tempDir(), 'clip.avi')
    writeFileSync(source, 'video')
    await expect(importVideo(source, tempDir())).rejects.toThrow('MP4 or WebM')
  })

  it('rejects videos over the limit', async () => {
    const source = join(tempDir(), 'big.webm')
    writeFileSync(source, '')
    truncateSync(source, MAX_VIDEO_BYTES + 1)
    await expect(importVideo(source, tempDir())).rejects.toThrow('under 200 MB')
  })

  it('keeps only the newest video', async () => {
    const source = join(tempDir(), 'clip.webm')
    writeFileSync(source, 'video')
    const folder = tempDir()
    await importVideo(source, folder)
    const newest = await importVideo(source, folder)
    expect(readdirSync(folder)).toEqual([newest])
  })
})

describe('parseRange', () => {
  it('reads every form of a range', () => {
    expect(parseRange('bytes=0-4', 10)).toEqual({ start: 0, end: 4 })
    expect(parseRange('bytes=5-', 10)).toEqual({ start: 5, end: 9 })
    expect(parseRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 })
    expect(parseRange('bytes=8-99', 10)).toEqual({ start: 8, end: 9 })
  })

  it('rejects what cannot be served', () => {
    expect(parseRange('bytes=20-30', 10)).toBeNull()
    expect(parseRange('bytes=5-1', 10)).toBeNull()
    expect(parseRange('bytes=-', 10)).toBeNull()
    expect(parseRange('items=0-1', 10)).toBeNull()
  })
})

describe('videoResponse', () => {
  it('serves a whole file and advertises ranges', async () => {
    const response = await videoResponse(request(NAME), folderWithVideo())
    expect(response.status).toBe(200)
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(await response.text()).toBe('0123456789')
  })

  it('serves a byte range', async () => {
    const response = await videoResponse(request(NAME, 'bytes=2-5'), folderWithVideo())
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(await response.text()).toBe('2345')
  })

  it('answers 416 for a range past the end', async () => {
    const response = await videoResponse(request(NAME, 'bytes=50-'), folderWithVideo())
    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */10')
  })

  it.each([
    'missing.mp4',
    '12345678-1234-1234-1234-123456789abd.mp4',
    '..%2F..%2Fsecrets.json',
    '%2e%2e%2fsecrets.json',
    'secrets.json',
    `${NAME}%00.txt`,
    `sub/${NAME}`,
    '%E0%A4%A'
  ])('refuses %s', async (path) => {
    const folder = folderWithVideo()
    writeFileSync(join(folder, 'secrets.json'), 'secret')
    const response = await videoResponse(request(path), folder)
    expect(response.status).toBe(404)
  })

  it('refuses other hosts', async () => {
    const response = await videoResponse(
      new Request(`gramatrix-media://other/${NAME}`),
      folderWithVideo()
    )
    expect(response.status).toBe(404)
  })
})
