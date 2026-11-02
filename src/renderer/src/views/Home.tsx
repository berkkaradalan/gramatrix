import { FileSearch, FlaskConical, Bug, Lightbulb, PenLine, Plug, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ModelRef, PermissionMode } from '@shared/types'
import { BotChip } from '../components/BotChip'
import { Composer } from '../components/Composer'
import { ModelPicker } from '../components/ModelPicker'
import { PermissionControl } from '../components/PermissionControl'
import { ProjectChip } from '../components/ProjectChip'
import { resolveDefaultModel, useApp } from '../state/app-context'
import { invoke, useAction } from '../state/hooks'
import { useNavigation } from '../state/navigation'
import { useOverlays } from '../state/overlays'

const PROJECT_STARTERS = [
  { icon: FileSearch, label: 'Explain this codebase', text: 'Explain how this codebase works.' },
  { icon: Bug, label: 'Find a bug', text: 'Find a bug in this project and propose a fix.' },
  {
    icon: FlaskConical,
    label: 'Add tests',
    text: 'Add tests for the least covered module.'
  }
]

const GENERAL_STARTERS = [
  { icon: Lightbulb, label: 'Plan a feature', text: 'Help me plan a new feature: ' },
  { icon: PenLine, label: 'Review an idea', text: 'Review this idea and find the weak spots: ' },
  {
    icon: Sparkles,
    label: 'Compare options',
    text: 'Compare these two approaches and recommend one: '
  }
]

export function Home({
  initialProjectId,
  initialBotId = null
}: {
  initialProjectId: string | null
  initialBotId?: string | null
}): ReactNode {
  const { settings, providers, bots, rememberModel, reloadChats } = useApp()
  const { navigate } = useNavigation()
  const { openProviders } = useOverlays()
  const [text, setText] = useState('')
  const [projectId, setProjectId] = useState(initialProjectId)
  const [botId, setBotId] = useState(initialBotId)
  // A bot brings its own model. Picking another model afterwards still wins.
  const [pickedModel, setPickedModel] = useState<ModelRef | null>(
    () => bots.find(({ id }) => id === initialBotId)?.model ?? null
  )
  const [permission, setPermission] = useState<PermissionMode>(settings.defaultPermissionMode)
  const input = useRef<HTMLTextAreaElement>(null)
  const { busy, run } = useAction()

  useEffect(() => {
    setProjectId(initialProjectId)
    input.current?.focus()
  }, [initialProjectId])

  const chooseBot = (id: string | null): void => {
    setBotId(id)
    setPickedModel(bots.find((candidate) => candidate.id === id)?.model ?? null)
  }

  // Coming back to Home from elsewhere starts with the bot the route asks for, like the project.
  useEffect(() => chooseBot(initialBotId), [initialBotId])

  const bot = bots.find(({ id }) => id === botId)

  const connected = providers.some(({ configured }) => configured)
  const pickedUsable = providers.some(
    ({ id, configured }) => configured && id === pickedModel?.provider
  )
  const model = pickedUsable ? pickedModel : resolveDefaultModel(settings, providers)
  const canSend = Boolean(text.trim()) && !busy
  const starters = projectId ? PROJECT_STARTERS : GENERAL_STARTERS

  const send = (): void => {
    if (!connected || !model) {
      openProviders()
      return
    }
    const message = text.trim()
    if (!message || busy) return
    void run(async () => {
      const chat = await invoke('chats.create', {
        projectId,
        model,
        permissionMode: permission,
        botId: bot?.id ?? null
      })
      try {
        await invoke('agent.send', { chatId: chat.id, text: message })
      } catch (error) {
        // A chat that never started should not stay behind as an empty row.
        await invoke('chats.remove', { id: chat.id })
        throw error
      }
      rememberModel(model)
      await reloadChats()
      navigate({ view: 'chat', chatId: chat.id })
    })
  }

  return (
    <div className="home">
      <div className="home-column">
        <h1>{bot ? `Chat with ${bot.name}` : 'What should we work on?'}</h1>
        <Composer
          ref={input}
          large
          autoFocus
          value={text}
          onChange={setText}
          onSubmit={send}
          canSend={canSend || (!connected && Boolean(text.trim()))}
          placeholder={
            !connected
              ? 'Connect a provider to start chatting'
              : bot
                ? `Message ${bot.name}`
                : 'Ask anything, or describe a task'
          }
        >
          <ProjectChip projectId={projectId} onChange={setProjectId} />
          <BotChip botId={bot?.id ?? null} onChange={chooseBot} />
          {connected ? (
            <ModelPicker value={model} onChange={setPickedModel} />
          ) : (
            <button type="button" className="chip chip-accent" onClick={() => openProviders()}>
              <Plug size={14} aria-hidden />
              <span className="chip-label">Connect a provider</span>
            </button>
          )}
          {projectId && <PermissionControl compact value={permission} onChange={setPermission} />}
        </Composer>
        <div className="starters">
          {starters.map(({ icon: Icon, label, text: starter }) => (
            <button
              key={label}
              type="button"
              className="starter"
              onClick={() => {
                setText(starter)
                input.current?.focus()
              }}
            >
              <Icon size={14} aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
