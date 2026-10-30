import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveInProject } from './paths'
import { createProjectDirectory } from './testing'

describe('resolveInProject', () => {
  it('resolves relative and absolute paths inside the project', async () => {
    const root = createProjectDirectory()
    writeFileSync(join(root, 'a.txt'), 'a')
    await expect(resolveInProject(root, 'a.txt')).resolves.toBe(join(root, 'a.txt'))
    await expect(resolveInProject(root, join(root, 'a.txt'))).resolves.toBe(join(root, 'a.txt'))
    await expect(resolveInProject(root, '.')).resolves.toBe(root)
  })

  it('allows paths that do not exist yet', async () => {
    const root = createProjectDirectory()
    await expect(resolveInProject(root, 'new/deep/file.txt')).resolves.toBe(
      join(root, 'new/deep/file.txt')
    )
  })

  it('rejects dot dot and absolute escapes', async () => {
    const root = createProjectDirectory()
    await expect(resolveInProject(root, '../secret')).rejects.toThrow('outside the project')
    await expect(resolveInProject(root, 'a/../../secret')).rejects.toThrow('outside the project')
    await expect(resolveInProject(root, '/etc/passwd')).rejects.toThrow('outside the project')
  })

  it('does not mistake a sibling with the same prefix for the project', async () => {
    const root = createProjectDirectory()
    await expect(resolveInProject(root, `${root}-other/file`)).rejects.toThrow('outside')
  })

  it('allows names that merely begin with two dots', async () => {
    const root = createProjectDirectory()
    await expect(resolveInProject(root, '..hidden')).resolves.toBe(join(root, '..hidden'))
  })

  it('rejects symlinks to files and directories outside', async () => {
    const root = createProjectDirectory()
    const outside = createProjectDirectory()
    writeFileSync(join(outside, 'secret'), 'x')
    symlinkSync(join(outside, 'secret'), join(root, 'file-link'))
    symlinkSync(outside, join(root, 'dir-link'))
    await expect(resolveInProject(root, 'file-link')).rejects.toThrow('outside')
    await expect(resolveInProject(root, 'dir-link/secret')).rejects.toThrow('outside')
    await expect(resolveInProject(root, 'dir-link/new-file')).rejects.toThrow('outside')
  })

  it('rejects a dangling symlink that a write would follow out of the project', async () => {
    const root = createProjectDirectory()
    const outside = createProjectDirectory()
    symlinkSync(join(outside, 'not-yet'), join(root, 'dangling'))
    await expect(resolveInProject(root, 'dangling')).rejects.toThrow('outside')
    await expect(resolveInProject(root, 'dangling/child')).rejects.toThrow('outside')
  })

  it('follows symlinks that stay inside the project', async () => {
    const root = createProjectDirectory()
    mkdirSync(join(root, 'real'))
    symlinkSync(join(root, 'real'), join(root, 'alias'))
    await expect(resolveInProject(root, 'alias/file')).resolves.toBe(join(root, 'real/file'))
  })
})
