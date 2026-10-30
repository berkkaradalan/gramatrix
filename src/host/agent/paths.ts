import { lstat, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

function isInside(root: string, target: string): boolean {
  const path = relative(root, target)
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

async function isSymlink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink()
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

/**
 * Turns a path from the model into a real absolute path inside the project.
 * Rejects `..` escapes and symlinks that lead outside, including through a parent
 * directory, and dangling links that a write would follow. The target may not exist yet.
 */
export async function resolveInProject(root: string, requested: string): Promise<string> {
  const realRoot = await realpath(root)
  const outside = new Error(`Path is outside the project: ${requested}`)
  const target = resolve(realRoot, requested)
  if (!isInside(realRoot, target)) throw outside

  const missingSegments: string[] = []
  let existing = target
  for (;;) {
    try {
      const real = await realpath(existing)
      if (!isInside(realRoot, real)) throw outside
      return join(real, ...missingSegments)
    } catch (error) {
      if (!isMissing(error)) throw error
      if (await isSymlink(existing)) throw outside
      missingSegments.unshift(basename(existing))
      existing = dirname(existing)
    }
  }
}

function hasGitSegment(path: string): boolean {
  // Lower case because macOS file systems usually ignore case.
  return path.split(sep).some((segment) => segment.toLowerCase() === '.git')
}

/**
 * Like `resolveInProject`, for paths that are about to change. Git metadata is refused because
 * settings such as `core.fsmonitor` in `.git/config` run commands, which would let a write
 * permission turn into command execution. Both the requested and the real path are checked, so
 * a link pointing at `.git` is covered.
 */
export async function resolveWritableInProject(root: string, requested: string): Promise<string> {
  const resolved = await resolveInProject(root, requested)
  const realRoot = await realpath(root)
  if (
    hasGitSegment(relative(realRoot, resolved)) ||
    hasGitSegment(relative(realRoot, resolve(realRoot, requested)))
  ) {
    throw new Error(`Changing git metadata is not allowed: ${requested}`)
  }
  return resolved
}
