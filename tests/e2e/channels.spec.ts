import { expect, test, type Page } from '@playwright/test'
import type { Channel, ChannelPairing } from '../../src/shared/types'
import type { FakeGlobals } from './fake-backend/fake-api'
import { SHELL_SEED } from './fake-backend/fixtures'
import { launchWithFakeBackend, recordedParams } from './fake-backend/launch-fake'

const TELEGRAM: Channel = {
  kind: 'telegram',
  enabled: true,
  projectId: null,
  model: null,
  permissionMode: 'read-only',
  botId: null,
  state: 'connected',
  error: null,
  account: 'gramatrix_test_bot'
}

const OFF: Channel = { ...TELEGRAM, enabled: false, state: 'disabled', account: null }
const LINK = 'https://t.me/gramatrix_test_bot?start=K7Q2M9AB'

function pairingCode(expiresInMs = 600_000, link: string | null = LINK) {
  return { code: 'K7Q2M9AB', expiresAt: Date.now() + expiresInMs, link }
}

async function openSetup(page: Page, button: 'Set up' | 'Manage'): Promise<void> {
  await page.getByRole('button', { name: 'Channels' }).click()
  await page.getByRole('button', { name: button }).first().click()
}

/** Acts like the host when someone pairs: new pairings, then the event that announces them. */
function pairFromChatApp(page: Page, pairing: ChannelPairing): Promise<void> {
  return page.evaluate((paired) => {
    const { fakeBackend } = globalThis as unknown as FakeGlobals
    fakeBackend.results['channels.pairings'] = [paired]
    fakeBackend.emit('channels.changed', fakeBackend.results['channels.list'] as Channel[])
  }, pairing)
}

test('a channel without a bot says how to get one and waits with pairing', async () => {
  const { page, close } = await launchWithFakeBackend({
    ...SHELL_SEED,
    overrides: { 'channels.list': [OFF] }
  })
  await openSetup(page, 'Set up')
  const dialog = page.getByRole('dialog', { name: 'Set up Telegram' })
  const connect = dialog.getByRole('region', { name: 'Connect your bot' })
  await expect(connect.getByRole('button', { name: /@BotFather/ })).toBeVisible()
  await expect(dialog.getByRole('region', { name: 'Pair your account' })).toContainText(
    'Connect the bot first'
  )
  await expect(dialog.getByRole('button', { name: 'Pair my account' })).toHaveCount(0)
  await close()
})

test('saving the token turns the channel on', async () => {
  const { page, close } = await launchWithFakeBackend({
    ...SHELL_SEED,
    overrides: { 'channels.list': [OFF] }
  })
  await openSetup(page, 'Set up')
  await page.getByLabel('Bot token').fill('123456:ABC-DEF')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect
    .poll(() => recordedParams(page, 'channels.configure'))
    .toMatchObject({ kind: 'telegram', enabled: true })
  await close()
})

test('a connected bot pairs with a link, a QR code or a message, and says when it worked', async () => {
  const { page, close } = await launchWithFakeBackend({
    ...SHELL_SEED,
    overrides: {
      'channels.list': [TELEGRAM],
      'secrets.has': true,
      'channels.createPairingCode': pairingCode()
    }
  })
  await openSetup(page, 'Manage')
  const dialog = page.getByRole('dialog', { name: 'Set up Telegram' })
  await expect(dialog).toContainText('Connected as @gramatrix_test_bot')

  await dialog.getByRole('button', { name: 'Pair my account' }).click()
  await expect(dialog.getByRole('img', { name: 'QR code of the pairing link' })).toBeVisible()
  await expect(dialog.getByText('/pair K7Q2M9AB')).toBeVisible()
  await expect(dialog).toContainText('Waiting for you in Telegram')
  await dialog.getByRole('button', { name: 'Open in Telegram' }).click()
  await expect.poll(() => recordedParams(page, 'app.openExternal')).toEqual({ url: LINK })

  await pairFromChatApp(page, {
    kind: 'telegram',
    externalUserId: '42',
    displayName: 'Berk',
    pairedAt: Date.now()
  })
  await expect(dialog).toContainText('Paired with Berk')
  await expect(dialog).toContainText('send /help to see its commands')
  await expect(dialog).toContainText('/model, /project, /bot and /mode change them')
  await expect(dialog.getByRole('button', { name: 'Open in Telegram' })).toHaveCount(0)
  await expect(dialog.getByRole('list', { name: 'Paired accounts' })).toContainText('Berk')
  await close()
})

test('Slack gets the bare code, because Slack takes any message starting with / as its own', async () => {
  const slack: Channel = { ...TELEGRAM, kind: 'slack', account: null }
  const { page, close } = await launchWithFakeBackend({
    ...SHELL_SEED,
    overrides: {
      'channels.list': [slack],
      'secrets.has': true,
      'channels.createPairingCode': pairingCode(600_000, null)
    }
  })
  await openSetup(page, 'Manage')
  const dialog = page.getByRole('dialog', { name: 'Set up Slack' })
  await dialog.getByRole('button', { name: 'Pair my account' }).click()
  await expect(dialog.locator('.code-box code')).toHaveText('K7Q2M9AB')
  await expect(dialog.getByRole('button', { name: 'Open in Telegram' })).toHaveCount(0)
  await close()
})

test('an expired code says so and offers a new one', async () => {
  const { page, close } = await launchWithFakeBackend({
    ...SHELL_SEED,
    overrides: {
      'channels.list': [TELEGRAM],
      'secrets.has': true,
      'channels.createPairingCode': pairingCode(-1000)
    }
  })
  await openSetup(page, 'Manage')
  await page.getByRole('button', { name: 'Pair my account' }).click()
  await expect(page.getByText('This code expired.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create a new code' })).toBeVisible()
  await close()
})
