import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { z } from 'zod'
import { COMMAND_MARKER_VARIABLE, type CommandRegistry } from './commands'
import { resolveInProject, resolveWritableInProject } from './paths'
import type { ToolRisk } from './permissions'

export interface ToolRunContext {
  /** Project root. Every file tool stays inside it. */
  root: string
  signal: AbortSignal
  commands: CommandRegistry
}

/** A tool the agent can use. Results are plain text so they read well for model and user. */
export interface AgentTool {
  name: string
  risk: ToolRisk
  description: string
  inputSchema: z.ZodType
  /** One line for the approval prompt. */
  summarize(input: unknown): string
  run(input: unknown, context: ToolRunContext): Promise<string>
}

export function defineTool<Schema extends z.ZodType>(spec: {
  name: string
  risk: ToolRisk
  description: string
  inputSchema: Schema
  summarize(input: z.infer<Schema>): string
  run(input: z.infer<Schema>, context: ToolRunContext): Promise<string>
}): AgentTool {
  return {
    ...spec,
    summarize: (input) => spec.summarize(input as z.infer<Schema>),
    run: (input, context) => spec.run(input as z.infer<Schema>, context)
  }
}

export const MAX_READ_BYTES = 256 * 1024
export const MAX_LISTED_ENTRIES = 1000
export const MAX_SEARCH_MATCHES = 200
export const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024
export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000
export const MAX_COMMAND_TIMEOUT_MS = 600_000
/** How long output may keep arriving after the shell exits. */
export const COMMAND_OUTPUT_GRACE_MS = 200

const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'out', 'build', '.next'])
const MAX_SEARCHED_FILE_BYTES = 1024 * 1024

function looksBinary(content: string): boolean {
  return content.includes('\0')
}

/** Opening a FIFO blocks until a writer appears, and that wait cannot be aborted. */
async function assertRegularFile(path: string, label: string): Promise<void> {
  if (!(await stat(path)).isFile()) throw new Error(`${label} is not a regular file.`)
}

const readFileTool = defineTool({
  name: 'read_file',
  risk: 'read',
  description: 'Read a text file from the project. Large files are cut off.',
  inputSchema: z.object({ path: z.string().describe('Path relative to the project root') }),
  summarize: ({ path }) => `Read ${path}`,
  run: async ({ path }, { root }) => {
    const target = await resolveInProject(root, path)
    await assertRegularFile(target, path)
    const buffer = await readFile(target)
    const text = buffer.subarray(0, MAX_READ_BYTES).toString('utf8')
    if (looksBinary(text)) throw new Error(`${path} is a binary file.`)
    return buffer.length > MAX_READ_BYTES
      ? `${text}\n[File cut off after ${MAX_READ_BYTES} of ${buffer.length} bytes.]`
      : text
  }
})

const listDirTool = defineTool({
  name: 'list_dir',
  risk: 'read',
  description: 'List a directory in the project. Directory names end with a slash.',
  inputSchema: z.object({
    path: z.string().default('.').describe('Path relative to the project root')
  }),
  summarize: ({ path }) => `List ${path}`,
  run: async ({ path }, { root }) => {
    const entries = await readdir(await resolveInProject(root, path), { withFileTypes: true })
    const names = entries
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
      .sort()
    const shown = names.slice(0, MAX_LISTED_ENTRIES)
    if (names.length > shown.length) shown.push(`[${names.length - shown.length} more entries]`)
    return shown.length > 0 ? shown.join('\n') : '[Empty directory]'
  }
})

async function* walkFiles(directory: string, signal: AbortSignal): AsyncGenerator<string> {
  // Symbolic links are skipped, so the walk cannot leave the project.
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    signal.throwIfAborted()
    const path = join(directory, entry.name)
    if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) {
      yield* walkFiles(path, signal)
    } else if (entry.isFile()) {
      yield path
    }
  }
}

const searchFilesTool = defineTool({
  name: 'search_files',
  risk: 'read',
  description:
    'Find a literal, case insensitive string in project text files. Returns path:line: text.',
  inputSchema: z.object({
    query: z.string().min(1),
    path: z.string().default('.').describe('Directory to search, relative to the project root')
  }),
  summarize: ({ query }) => `Search for ${query}`,
  run: async ({ query, path }, { root, signal }) => {
    const realRoot = await resolveInProject(root, '.')
    const start = await resolveInProject(root, path)
    const needle = query.toLowerCase()
    const matches: string[] = []

    for await (const file of walkFiles(start, signal)) {
      if ((await stat(file)).size > MAX_SEARCHED_FILE_BYTES) continue
      const content = await readFile(file, 'utf8')
      if (looksBinary(content)) continue
      const lines = content.split('\n')
      for (const [index, line] of lines.entries()) {
        if (!line.toLowerCase().includes(needle)) continue
        matches.push(`${relative(realRoot, file)}:${index + 1}: ${line.trim().slice(0, 200)}`)
        if (matches.length === MAX_SEARCH_MATCHES) {
          return `${matches.join('\n')}\n[Stopped after ${MAX_SEARCH_MATCHES} matches.]`
        }
      }
    }
    return matches.length > 0 ? matches.join('\n') : 'No matches.'
  }
})

const writeFileTool = defineTool({
  name: 'write_file',
  risk: 'write',
  description: 'Create a file or replace its whole content. Parent directories are created.',
  inputSchema: z.object({ path: z.string(), content: z.string() }),
  summarize: ({ path }) => `Write ${path}`,
  run: async ({ path, content }, { root }) => {
    const target = await resolveWritableInProject(root, path)
    if (existsSync(target)) await assertRegularFile(target, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
    return `Wrote ${Buffer.byteLength(content)} bytes to ${path}.`
  }
})

const editFileTool = defineTool({
  name: 'edit_file',
  risk: 'write',
  description:
    'Replace an exact string in a file. oldText must match once unless replaceAll is true.',
  inputSchema: z.object({
    path: z.string(),
    oldText: z.string().min(1),
    newText: z.string(),
    replaceAll: z.boolean().default(false)
  }),
  summarize: ({ path }) => `Edit ${path}`,
  run: async ({ path, oldText, newText, replaceAll }, { root }) => {
    const target = await resolveWritableInProject(root, path)
    await assertRegularFile(target, path)
    const content = await readFile(target, 'utf8')
    const count = content.split(oldText).length - 1
    if (count === 0) throw new Error(`oldText was not found in ${path}.`)
    if (count > 1 && !replaceAll) {
      throw new Error(`oldText matches ${count} times in ${path}. Add context or use replaceAll.`)
    }
    // Function replacers keep `$` sequences in newText literal.
    const updated = replaceAll
      ? content.replaceAll(oldText, () => newText)
      : content.replace(oldText, () => newText)
    await writeFile(target, updated)
    return `Replaced ${count} occurrence(s) in ${path}.`
  }
})

function collectOutput(limit: number): { add(chunk: Buffer): void; text(): string } {
  const kept: Buffer[] = []
  let keptBytes = 0
  let droppedBytes = 0
  return {
    add: (chunk) => {
      const room = limit - keptBytes
      if (room > 0) kept.push(chunk.subarray(0, room))
      keptBytes += Math.min(room, chunk.length)
      droppedBytes += Math.max(chunk.length - room, 0)
    },
    text: () => {
      const text = Buffer.concat(kept).toString('utf8')
      return droppedBytes > 0 ? `${text}\n[Output cut off, ${droppedBytes} bytes dropped.]` : text
    }
  }
}

const runCommandTool = defineTool({
  name: 'run_command',
  risk: 'execute',
  description:
    'Run a shell command in the project root. Stdout and stderr are returned together. ' +
    'The command is not sandboxed, so it can reach anything the user can.',
  inputSchema: z.object({
    command: z.string().min(1),
    timeoutMs: z.number().int().positive().max(MAX_COMMAND_TIMEOUT_MS).optional()
  }),
  summarize: ({ command }) => `Run ${command}`,
  run: ({ command, timeoutMs }, { root, signal, commands }) =>
    new Promise((resolve, reject) => {
      signal.throwIfAborted()
      const marker = commands.newMarker()
      // A new process group lets the whole command tree be killed, not only the shell.
      const child = spawn('/bin/sh', ['-c', command], {
        cwd: root,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, [COMMAND_MARKER_VARIABLE]: marker }
      })
      const { kill } = commands.track(child, marker)
      const output = collectOutput(MAX_COMMAND_OUTPUT_BYTES)
      let timedOut = false
      let outputGrace: NodeJS.Timeout | undefined

      const timer = setTimeout(() => {
        timedOut = true
        kill()
      }, timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS)
      signal.addEventListener('abort', kill, { once: true })

      const cleanUp = (): void => {
        clearTimeout(timer)
        clearTimeout(outputGrace)
        signal.removeEventListener('abort', kill)
      }
      const finish = (code: number | null, killSignal: NodeJS.Signals | null): void => {
        cleanUp()
        child.stdout.destroy()
        child.stderr.destroy()
        if (signal.aborted) {
          reject(new Error('Command cancelled.'))
          return
        }
        const status = timedOut
          ? 'timed out'
          : code === null
            ? `killed by ${killSignal}`
            : `exit code ${code}`
        resolve(`[${status}]\n${output.text()}`)
      }

      child.stdout.on('data', output.add)
      child.stderr.on('data', output.add)
      child.on('error', (error) => {
        cleanUp()
        reject(error)
      })
      // `close` waits for every holder of the pipes, and a background process can hold them
      // for as long as it lives, so the shell exiting has to be enough to finish.
      child.on('exit', (code, killSignal) => {
        outputGrace = setTimeout(() => finish(code, killSignal), COMMAND_OUTPUT_GRACE_MS)
      })
      child.on('close', finish)
    })
})

export const BASE_TOOLS: readonly AgentTool[] = [
  readFileTool,
  listDirTool,
  searchFilesTool,
  writeFileTool,
  editFileTool,
  runCommandTool
]
