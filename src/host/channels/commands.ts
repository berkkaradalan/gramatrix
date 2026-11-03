import {
  PERMISSION_LABELS,
  PERMISSION_MODES,
  type Bot,
  type ModelRef,
  type PermissionMode,
  type Project,
  type ProviderId
} from '@shared/types'
import { PROVIDERS } from '../providers/catalog'
import type { Choice } from './adapter'
import type { ThreadChoice, ThreadChoices } from './thread-choices'

export interface ChannelCommand {
  /** Lower case, without the slash, as Telegram requires for its command menu. */
  name: string
  description: string
}

/** The commands a paired person can send. Telegram shows them in its menu, in this order. */
export const CHANNEL_COMMANDS: readonly ChannelCommand[] = [
  { name: 'new', description: 'Start a new chat' },
  { name: 'stop', description: 'Stop the answer that is running' },
  { name: 'status', description: 'Show the project, model and bot of this chat' },
  { name: 'model', description: 'Choose the model for this chat' },
  { name: 'project', description: 'Choose the project for this chat' },
  { name: 'bot', description: 'Choose who answers in this chat' },
  { name: 'mode', description: 'Choose what the agent may do in this chat' },
  { name: 'help', description: 'Show what this bot can do' }
]

export type CommandName = 'new' | 'stop' | 'status' | 'model' | 'project' | 'bot' | 'mode' | 'help'

export interface ParsedCommand {
  name: CommandName
  /** Everything after the command, trimmed. Empty when nothing followed it. */
  argument: string
}

/** Lists offer the most recent entries as buttons. Others can still be chosen by name. */
const MAX_OPTIONS = 12

const COMMAND_PATTERN = /^\/([a-z]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i

/**
 * Reads a known command. Anything else, including text that only starts with a slash such as a
 * file path, is null and goes to the agent as usual.
 */
export function parseCommand(text: string): ParsedCommand | null {
  const match = COMMAND_PATTERN.exec(text.trim())
  const name = match?.[1]?.toLowerCase()
  if (!name || !CHANNEL_COMMANDS.some((command) => command.name === name)) return null
  return { name: name as CommandName, argument: match?.[2]?.trim() ?? '' }
}

/** What a reply says, and the buttons under it, if any. */
export interface CommandReply {
  text: string
  choices?: Choice[]
}

/** What one conversation uses: the channel settings with its own choices applied. */
export interface ThreadSettings {
  projectId: string | null
  model: ModelRef | null
  botId: string | null
  permissionMode: PermissionMode
}

/** Everything a command needs to answer, gathered by the channel service. */
export interface CommandContext {
  /** The channel settings, before the conversation's own choices. */
  defaults: ThreadSettings
  current: ThreadSettings
  choices: ThreadChoices
  projects: Project[]
  bots: Bot[]
  /** Models worth offering, most relevant first. */
  models: ModelRef[]
  /** Providers with a key, so a typed model can be checked. */
  readyProviders: ProviderId[]
  /** Whether an answer is running or waiting in this conversation. */
  busy: boolean
}

/** What a picker command decided. The channel service stores the change. */
export type PickChange = { set: ThreadChoices } | { reset: ThreadChoice }

export interface PickResult {
  reply: CommandReply
  change?: PickChange
}

export function helpReply(): CommandReply {
  const lines = CHANNEL_COMMANDS.map(({ name, description }) => `/${name} - ${description}`)
  return {
    text: [
      'Send a message to talk to your agent. These commands change how it answers here:',
      '',
      ...lines,
      '',
      'Choices made here only apply to this chat. The settings in Gramatrix apply everywhere else.'
    ].join('\n')
  }
}

export function statusReply(context: CommandContext): CommandReply {
  const { current, choices } = context
  const mark = (choice: ThreadChoice): string => (choice in choices ? ' (chosen here)' : '')
  const lines = [
    `Project: ${projectLabel(current.projectId, context.projects)}${mark('projectId')}`,
    `Model: ${current.model ? modelLabel(current.model) : 'none chosen'}${mark('model')}`,
    `Answers as: ${botLabel(current.botId, context.bots)}${mark('botId')}`,
    `Permissions: ${PERMISSION_LABELS[current.permissionMode]}${mark('permissionMode')}`,
    '',
    context.busy
      ? 'An answer is running. Send /stop to stop it.'
      : 'Change these with /project, /model, /bot and /mode.'
  ]
  return { text: lines.join('\n') }
}

interface Option {
  label: string
  /** Stored when this option is chosen. */
  set: ThreadChoices
  /** True for what the conversation uses now. */
  current: boolean
}

interface Picker {
  command: CommandName
  choice: ThreadChoice
  /** For example "model", as in "Choose a model for this chat". */
  noun: string
  options: Option[]
  /** Said instead of a list when there is nothing to choose from. */
  empty?: string
  /** A line added under the list. */
  note?: string
}

function modelPicker(context: CommandContext): Picker {
  const { current } = context
  return {
    command: 'model',
    choice: 'model',
    noun: 'model',
    options: context.models.map((model) => ({
      label: modelLabel(model),
      set: { model },
      current: current.model !== null && sameModel(current.model, model)
    })),
    empty: 'No model is ready yet. Add a provider and choose a model in Gramatrix first.',
    note: 'Models you used or starred in Gramatrix are listed. Send /model and a name for another.'
  }
}

function projectPicker(context: CommandContext): Picker {
  const { current } = context
  return {
    command: 'project',
    choice: 'projectId',
    noun: 'project',
    options: [
      {
        label: 'No project',
        set: { projectId: null },
        current: current.projectId === null
      },
      ...context.projects.map((project) => ({
        label: project.name,
        set: { projectId: project.id },
        current: current.projectId === project.id
      }))
    ],
    note: 'Without a project the agent can talk but cannot read or change files.'
  }
}

function botPicker(context: CommandContext): Picker {
  const { current } = context
  return {
    command: 'bot',
    choice: 'botId',
    noun: 'bot',
    options: [
      { label: 'Gramatrix', set: { botId: null }, current: current.botId === null },
      // A bot brings its own model, as it does when it is chosen in the app.
      ...context.bots.map((bot) => ({
        label: bot.name,
        set: { botId: bot.id, model: bot.model },
        current: current.botId === bot.id
      }))
    ],
    note: 'Changing who answers starts a new chat.'
  }
}

function modePicker(context: CommandContext): Picker {
  const { current, defaults } = context
  // Never above the mode set in the app, so a chat cannot give itself more power.
  const allowed = PERMISSION_MODES.slice(0, PERMISSION_MODES.indexOf(defaults.permissionMode) + 1)
  return {
    command: 'mode',
    choice: 'permissionMode',
    noun: 'permission mode',
    options: allowed.map((permissionMode) => ({
      label: PERMISSION_LABELS[permissionMode],
      set: { permissionMode },
      current: current.permissionMode === permissionMode
    })),
    note:
      `Gramatrix allows up to ${PERMISSION_LABELS[defaults.permissionMode]} here. ` +
      'Raise it in the channel settings in the app. Actions that need approval are denied in chats.'
  }
}

const PICKERS: Partial<Record<CommandName, (context: CommandContext) => Picker>> = {
  model: modelPicker,
  project: projectPicker,
  bot: botPicker,
  mode: modePicker
}

export function isPickerCommand(name: CommandName): boolean {
  return name in PICKERS
}

const RESET_WORDS = new Set(['default', 'reset'])

/**
 * Answers /model, /project, /bot and /mode. Without an argument it lists the options as buttons.
 * With one it picks the option by number or name, or "default" goes back to the app setting.
 */
export function pick(name: CommandName, argument: string, context: CommandContext): PickResult {
  const createPicker = PICKERS[name]
  if (!createPicker) throw new Error(`/${name} does not choose anything.`)
  const picker = createPicker(context)
  const hasChoice = picker.choice in context.choices

  if (!argument) return { reply: menu(picker, hasChoice) }

  if (RESET_WORDS.has(argument.toLowerCase())) {
    return {
      reply: { text: `This chat uses the ${picker.noun} from the Gramatrix settings again.` },
      change: { reset: picker.choice }
    }
  }

  const option = findOption(picker.options, argument)
  if (option) {
    return {
      reply: { text: `${capitalize(picker.noun)} for this chat: ${option.label}.` },
      change: { set: option.set }
    }
  }
  if (name === 'model') {
    const typed = parseModelRef(argument)
    if (typed && !context.readyProviders.includes(typed.provider)) {
      return {
        reply: { text: `${providerLabel(typed.provider)} has no key yet. Add one in Gramatrix.` }
      }
    }
    if (typed) {
      return {
        reply: { text: `Model for this chat: ${modelLabel(typed)}.` },
        change: { set: { model: typed } }
      }
    }
  }
  return {
    reply: {
      text: `There is no ${picker.noun} called "${argument}". Send /${picker.command} to see the list.`
    }
  }
}

function menu(picker: Picker, hasChoice: boolean): CommandReply {
  if (picker.options.length === 0) return { text: picker.empty ?? 'There is nothing to choose.' }
  const shown = picker.options.slice(0, MAX_OPTIONS)
  const now = picker.options.find((option) => option.current)
  const choices: Choice[] = shown.map((option, index) => ({
    label: option.current ? `${option.label} (now)` : option.label,
    command: `/${picker.command} ${index + 1}`
  }))
  if (hasChoice) {
    choices.push({ label: 'Use the Gramatrix setting', command: `/${picker.command} default` })
  }
  const lines = [
    `Choose a ${picker.noun} for this chat.${now ? ` Now: ${now.label}.` : ''}`,
    ...(picker.note ? [picker.note] : [])
  ]
  if (picker.options.length > shown.length) {
    lines.push(
      `Showing ${shown.length} of ${picker.options.length}. Send /${picker.command} and a name for the rest.`
    )
  }
  return { text: lines.join('\n'), choices }
}

/** A list number first, then an exact name, then a single partial match. */
function findOption(options: Option[], argument: string): Option | undefined {
  const query = argument.toLowerCase()
  if (/^\d+$/.test(query)) return options[Number(query) - 1]
  const exact = options.find((option) => option.label.toLowerCase() === query)
  if (exact) return exact
  const partial = options.filter((option) => option.label.toLowerCase().includes(query))
  return partial.length === 1 ? partial[0] : undefined
}

/** Accepts "provider/model", such as "openai/gpt-5.5", for a model that is not in the list. */
function parseModelRef(text: string): ModelRef | null {
  const slash = text.indexOf('/')
  if (slash <= 0) return null
  const provider = PROVIDERS.find(({ id }) => id === text.slice(0, slash))
  const model = text.slice(slash + 1).trim()
  return provider && model ? { provider: provider.id, model } : null
}

export function sameModel(a: ModelRef, b: ModelRef): boolean {
  return a.provider === b.provider && a.model === b.model
}

export function modelLabel({ provider, model }: ModelRef): string {
  return `${model} - ${providerLabel(provider)}`
}

function providerLabel(provider: ProviderId): string {
  return PROVIDERS.find(({ id }) => id === provider)?.label ?? provider
}

function projectLabel(projectId: string | null, projects: Project[]): string {
  if (projectId === null) return 'none'
  return projects.find((project) => project.id === projectId)?.name ?? 'none'
}

function botLabel(botId: string | null, bots: Bot[]): string {
  if (botId === null) return 'Gramatrix'
  return bots.find((bot) => bot.id === botId)?.name ?? 'Gramatrix'
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
