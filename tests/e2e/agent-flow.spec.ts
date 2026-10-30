import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import type { AppSettings, Channel, JobRun, UsageReport } from '../../src/shared/types'
import { launchApp } from './launch-app'

type Reply = { text: string } | { tool: string; args: unknown }

interface FakeProvider {
  baseUrl: string
  requests: { messages: { role: string }[] }[]
  close(): void
}

function sse(chunks: unknown[]): string {
  const lines = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
  return `${lines.join('')}data: [DONE]\n\n`
}

function completion(reply: Reply): string {
  const delta =
    'text' in reply
      ? { content: reply.text }
      : {
          tool_calls: [
            {
              index: 0,
              id: 'call-1',
              type: 'function',
              function: { name: reply.tool, arguments: JSON.stringify(reply.args) }
            }
          ]
        }
  const finish = 'text' in reply ? 'stop' : 'tool_calls'
  return sse([
    { id: '1', choices: [{ index: 0, delta }] },
    { id: '1', choices: [{ index: 0, delta: {}, finish_reason: finish }] }
  ])
}

function plainCompletion(reply: Reply): string {
  const content = 'text' in reply ? reply.text : ''
  return JSON.stringify({
    id: '1',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  })
}

/** A local OpenAI compatible server that plays back scripted replies, one per request. */
async function startFakeProvider(replies: Reply[]): Promise<FakeProvider> {
  const requests: FakeProvider['requests'] = []
  const queue = [...replies]
  const server: Server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      if (request.method !== 'POST') {
        response.writeHead(200, { 'content-type': 'application/json' })
        const count = 120
        const data = Array.from({ length: count }, (_, index) => ({ id: `fake-model-${index}` }))
        response.end(JSON.stringify({ data }))
        return
      }
      const parsed = JSON.parse(body) as FakeProvider['requests'][number] & { stream?: boolean }
      requests.push(parsed)
      const reply = queue.shift() ?? { text: 'done' }
      if (parsed.stream) {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end(completion(reply))
      } else {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(plainCompletion(reply))
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { baseUrl: `http://127.0.0.1:${port}/v1`, requests, close: () => server.close() }
}

/** Calls the app's RPC API from the page, the same way the interface does. */
function invoker(page: Page) {
  return <T>(method: string, params?: unknown): Promise<T> =>
    page.evaluate(
      ([name, value]) => {
        const { gramatrix } = globalThis as unknown as {
          gramatrix: { invoke(method: unknown, params: unknown): Promise<T> }
        }
        return gramatrix.invoke(name, value)
      },
      [method, params] as const
    )
}

const HOME = { name: 'What should we work on?' }

/** Walks through onboarding for real: the key goes through the actual secret store. */
async function finishOnboarding(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Get started' }).click()
  await expect(page.getByText('saved keys are not really protected')).toBeVisible()
  await page.getByRole('button', { name: /OpenRouter/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('API key').fill('test-key')
  await dialog.getByRole('button', { name: 'Save and verify' }).click()
  await dialog.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Start using Gramatrix' }).click()
  await expect(page.getByRole('heading', HOME)).toBeVisible()
}

async function send(page: Page, text: string): Promise<void> {
  await page.getByLabel('Message').fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
}

test('a message runs a tool after approval and writes the file', async () => {
  const projectDirectory = realpathSync(mkdtempSync(join(tmpdir(), 'gramatrix-project-')))
  writeFileSync(join(projectDirectory, 'README.md'), 'hello')
  const provider = await startFakeProvider([
    { text: 'verified' },
    { tool: 'write_file', args: { path: 'note.txt', content: 'written by the agent' } },
    { text: 'The note is saved.' }
  ])
  const { app, page, close } = await launchApp({ GRAMATRIX_PROVIDER_BASE_URL: provider.baseUrl })
  await app.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
  }, projectDirectory)

  await finishOnboarding(page)
  await page.getByRole('button', { name: 'Project: No project' }).click()
  await page.getByRole('menuitem', { name: 'Add a project' }).click()
  await expect(page.getByRole('button', { name: /^Project: gramatrix-project-/ })).toBeVisible()
  await send(page, 'Write a note')

  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('The note is saved.')).toBeVisible()
  expect(readFileSync(join(projectDirectory, 'note.txt'), 'utf8')).toBe('written by the agent')
  expect(provider.requests.at(-1)?.messages.map(({ role }) => role)).toContain('tool')

  await page.getByRole('button', { name: 'Usage', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Usage', level: 1 })).toBeVisible()
  await expect(page.getByText('Could not load usage')).toBeHidden()
  const report = await invoker(page)<UsageReport>('usage.report', {})
  expect(report.totals.runs).toBeGreaterThan(0)

  await close()
  provider.close()
})

test('the model picker lists every model the provider returns and can pick one', async () => {
  const provider = await startFakeProvider([])
  const { page, close } = await launchApp({ GRAMATRIX_PROVIDER_BASE_URL: provider.baseUrl })
  const invoke = invoker(page)
  await invoke('secrets.set', { name: 'provider:openai', value: 'test-key' })
  await invoke('settings.update', {
    onboardingCompleted: true,
    defaultModel: { provider: 'openai', model: 'fake-model-0' }
  })
  await page.reload()

  await page.getByRole('button', { name: /fake-model-0/ }).click()
  const picker = page.locator('[cmdk-root]')
  await picker.getByText(/Show \d+ more models/).click()
  await expect(picker.locator('[cmdk-item]', { hasText: 'fake-model-119' })).toBeVisible()

  await page.getByPlaceholder('Search models').fill('model-77')
  await picker.locator('[cmdk-item]', { hasText: 'fake-model-77' }).click()
  await expect(page.getByRole('button', { name: /fake-model-77/ })).toBeVisible()

  await close()
  provider.close()
})

test('imports a working key from opencode and uses it', async () => {
  const dataHome = mkdtempSync(join(tmpdir(), 'gramatrix-xdg-'))
  mkdirSync(join(dataHome, 'opencode'))
  writeFileSync(
    join(dataHome, 'opencode', 'auth.json'),
    JSON.stringify({ 'zai-coding-plan': { type: 'api', key: 'opencode-key' } })
  )
  const provider = await startFakeProvider([{ text: 'verified' }])
  const { page, close } = await launchApp({
    GRAMATRIX_PROVIDER_BASE_URL: provider.baseUrl,
    XDG_DATA_HOME: dataHome
  })
  const invoke = invoker(page)
  await page.getByRole('button', { name: 'Get started' }).click()
  await page.getByRole('button', { name: /Z.ai Coding Plan/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Use my opencode key' }).click()
  await expect(dialog.getByText('is ready')).toBeVisible()
  expect(await invoke<boolean>('secrets.has', { name: 'provider:zai-coding-plan' })).toBe(true)

  await close()
  provider.close()
})

test('a saved key still works after a restart', async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'gramatrix-data-'))
  const provider = await startFakeProvider([{ text: 'verified' }, { text: 'Still connected.' }])
  const env = {
    GRAMATRIX_PROVIDER_BASE_URL: provider.baseUrl,
    GRAMATRIX_USER_DATA: dataDirectory
  }

  const first = await launchApp(env)
  await finishOnboarding(first.page)
  await first.close()

  const second = await launchApp(env)
  await send(second.page, 'Are you there?')
  await expect(second.page.getByText('Still connected.')).toBeVisible()

  await second.close()
  provider.close()
})

test('a scheduled job runs on the real host and records its history', async () => {
  const projectDirectory = realpathSync(mkdtempSync(join(tmpdir(), 'gramatrix-project-')))
  const provider = await startFakeProvider([{ text: 'verified' }, { text: 'Nightly report.' }])
  const { page, close } = await launchApp({ GRAMATRIX_PROVIDER_BASE_URL: provider.baseUrl })
  await finishOnboarding(page)

  const invoke = invoker(page)
  const project = await invoke<{ id: string }>('projects.add', { path: projectDirectory })
  const settings = await invoke<AppSettings>('settings.get')
  const job = await invoke<{ id: string }>('jobs.create', {
    projectId: project.id,
    name: 'Nightly',
    cron: '0 3 * * *',
    prompt: 'Report',
    model: settings.defaultModel,
    permissionMode: 'read-only',
    enabled: true,
    catchUp: false
  })
  await invoke('jobs.runNow', { id: job.id })
  await expect
    .poll(async () => (await invoke<JobRun[]>('jobs.runs', { jobId: job.id }))[0]?.status)
    .toBe('succeeded')

  await close()
  provider.close()
})

test('a channel with a bad token reports an error instead of crashing the host', async () => {
  const { page, close } = await launchApp()
  const invoke = invoker(page)
  await invoke('secrets.set', { name: 'channel:telegram:botToken', value: 'not-a-real-token' })
  await invoke('channels.configure', {
    kind: 'telegram',
    enabled: true,
    projectId: null,
    model: null,
    permissionMode: 'read-only'
  })
  await expect
    .poll(async () => {
      const channels = await invoke<Channel[]>('channels.list')
      return channels.find(({ kind }) => kind === 'telegram')?.state
    })
    .toBe('error')
  await close()
})
